import { beforeAll, afterAll, test, expect } from "vitest"
import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createPublicClient, createWalletClient, createTestClient, http, parseAbi, decodeFunctionData, keccak256, zeroAddress } from "viem"
import { mnemonicToAccount, toAccount } from "viem/accounts"
import { foundry } from "viem/chains"
import { toSafeSmartAccount } from "../../packages/permissionless/accounts/safe/toSafeSmartAccount"
import { setupContracts } from "../../packages/permissionless-test/mock-aa-infra/alto/index"

// Validation-only harness: no repository source changes; all transactions use a
// loopback Anvil chain and its public test mnemonic. No external RPC is used.
let rpc: string
const account = mnemonicToAccount("test test test test test test test test test test test junk")
let client: any
let wallet: any
let evm: any
const launchpad = "0x75798463024Bda64D83c94A64Bc7D7eaB41300eF"
const fixtures = JSON.parse(readFileSync(new URL("./public-fixtures.json", import.meta.url), "utf8").replace(/^\uFEFF/, ""))
const launch = { deployed_bytecode: fixtures.launchpadRuntime }
const artifact = fixtures.adapter
const launchArtifact = { abi: fixtures.launchpadAbi }
const factoryAbi = parseAbi(["function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)"])
let child: ReturnType<typeof spawn>
let adapter: `0x${string}`
let entrypoint: `0x${string}`
const facts: Record<string, unknown> = { launchpad, externalRpc: false, scope: "Real EVM factory deployment, initHash comparison and first setupSafe execution; direct EntryPoint impersonation bypasses ERC4337 validation/bundler and signature checks." }

beforeAll(async () => {
  const { default: getPort } = await import("get-port")
  const port = await getPort({ host: "127.0.0.1" })
  rpc = `http://127.0.0.1:${port}`
  client = createPublicClient({ chain: foundry, transport: http(rpc, {retryCount: 0, timeout: 1000}) })
  wallet = createWalletClient({ account, chain: foundry, transport: http(rpc) })
  evm = createTestClient({ mode: "anvil", chain: foundry, transport: http(rpc) })
  child = spawn(process.env.ANVIL_BIN || "anvil", ["--host", "127.0.0.1", "--port", String(port), "--hardfork", "prague", "--silent"], { windowsHide: true, stdio: "ignore" })
  for (let i = 0; i < 80; i++) {
    try { await client.getChainId(); break } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  await setupContracts(rpc)
  await evm.setCode({ address: launchpad, bytecode: launch.deployed_bytecode })
  entrypoint = await client.readContract({ address: launchpad, abi: parseAbi(["function SUPPORTED_ENTRYPOINT() view returns (address)"]), functionName: "SUPPORTED_ENTRYPOINT" })
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Adapter deployment failed")
  adapter = receipt.contractAddress
  facts.adapter = adapter
  facts.entrypoint = entrypoint
  facts.launchpadRuntimeHash = keccak256(await client.getCode({ address: launchpad }) as `0x${string}`)
})
afterAll(() => {
  child?.kill()
  writeFileSync(new URL("./result.local.json", import.meta.url), JSON.stringify(facts, null, 2))
})

const makeAccount = (validators: {address: `0x${string}`, context: `0x${string}`}[] = [], saltNonce = 42n) => toSafeSmartAccount({ client, owners: [toAccount(account.address)], version: "1.4.1", erc7579LaunchpadAddress: launchpad, erc7579Version: "v1", safe4337ModuleAddress: adapter, validators, saltNonce })

test("verified deployed v1 hash matches SDK factory prevalidation hash with typed validator", async () => {
  const smart = await makeAccount([{address: account.address, context: "0x1234"}])
  const { factoryData } = await smart.getFactoryArgs()
  const factory = decodeFunctionData({ abi: factoryAbi, data: factoryData! })
  const pre = decodeFunctionData({ abi: launchArtifact.abi, data: factory.args![1] as `0x${string}` })
  const execution = decodeFunctionData({ abi: launchArtifact.abi, data: await smart.encodeCalls([{to: zeroAddress, value: 0n, data: "0x"}]) })
  const actual = await client.readContract({address: launchpad, abi: launchArtifact.abi, functionName: "hash", args: [execution.args![0]]})
  expect(actual).toBe(pre.args![0])
  facts.validatorInitHash = actual
})

test("factory deploys predicted address and first v1 setupSafe executes on real EVM", async () => {
  const smart = await makeAccount([], 43n)
  const { factory, factoryData } = await smart.getFactoryArgs()
  // The first user operation is encoded before its factory creates the proxy.
  const data = await smart.encodeCalls([{to: zeroAddress, value: 0n, data: "0x"}])
  const hash = await wallet.sendTransaction({ to: factory!, data: factoryData!, gas: 8_000_000n })
  const deployed = await client.waitForTransactionReceipt({hash})
  expect(deployed.status).toBe("success")
  expect(await client.getCode({address: smart.address})).not.toBe("0x")
  await evm.impersonateAccount({address: entrypoint})
  await evm.setBalance({address: entrypoint, value: 10n ** 20n})
  const entryWallet = createWalletClient({account: entrypoint, chain: foundry, transport: http(rpc)})
  const setup = await entryWallet.sendTransaction({to: smart.address, data, gas: 8_000_000n})
  const receipt = await client.waitForTransactionReceipt({hash: setup})
  if (receipt.status !== "success") {
    const trace = await evm.request({method: "debug_traceTransaction" as any, params: [setup, {}] as any})
    writeFileSync(new URL("./revert.local.json", import.meta.url), JSON.stringify(trace, null, 2))
  }
  expect(receipt.status).toBe("success")
  expect(await client.readContract({address: smart.address, abi: parseAbi(["function getOwners() view returns (address[])"]), functionName: "getOwners"})).toEqual([account.address])
  expect(await client.readContract({address: smart.address, abi: parseAbi(["function isModuleEnabled(address) view returns (bool)"]), functionName: "isModuleEnabled", args: [adapter]})).toBe(true)
  facts.factoryTransaction = hash
  facts.firstSetupTransaction = setup
  facts.predictedDeployedAddress = smart.address
  facts.firstSetupStatus = receipt.status
})

