# Safe7579 v1 real-EVM validation

Supplemental validation for [PR #572](https://github.com/pimlicolabs/permissionless.js/pull/572), based on SDK commit `a7a493d51a570dcd5228716f69b05e51279e3e4a`. No SDK source, existing tests, workflows, or dependencies are changed on this validation branch.

## Run

Install the repository's existing dependencies and put Foundry `anvil` on PATH, then run from the repository root:

```sh
node node_modules/vitest/vitest.mjs run --config validation/safe7579-v1-evm/vitest.config.mjs
```

Alternatively set `ANVIL_BIN` to the Anvil executable. On restricted Windows environments, set `TEMP` and `TMP` to a writable directory inside the checkout before running. The fixture starts Anvil on a dynamically chosen **127.0.0.1** port and stops it after the tests. Only the public Anvil test mnemonic is used. No external RPC, wallet, API key, live funds, or paid service is required. `result.local.json` and a failure trace, if any, are ignored locally.

## Assertions and result

Validated on 2026-11-04 with Anvil 1.7.1 (commit `4072e48705af9d93e3c0f6e29e93b5e9a40caed8`) and Vitest 4.1.12: **2 tests passed**.

1. Calls the exact deployed v1 launchpad runtime's `hash` on the SDK's first-operation InitData with a typed validator. Requires that result to equal the SDK factory initializer's `preValidationSetup` hash.
2. Uses the repository's existing local contract deployment fixture, then executes the SDK factory calldata. Checks bytecode exists at the SDK-predicted address. Executes the SDK's first `setupSafe` calldata, requires a successful receipt, and reads the Safe's owners plus enabled v1 adapter module to verify completed setup.

The first operation is encoded **before** its factory creates the proxy, matching the order used when building an initial user operation.

## Public fixture provenance

`public-fixtures.json` contains only the required public ABI and bytecode:

- Launchpad runtime: the cached verified runtime of Sepolia [`0x75798463024Bda64D83c94A64Bc7D7eaB41300eF`](https://sepolia.etherscan.io/address/0x75798463024Bda64D83c94A64Bc7D7eaB41300eF#code), retrieved 2026-10-31. Installed at its original address because its immutable SELF refers to that address. Its runtime keccak256 is `0x044b5e0086072ca4cb8e39c4d7fe5ae78def953b347eacd8d3abbba56946fb6e`; its supported EntryPoint is `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
- Launchpad ABI and adapter ABI/creation bytecode: published artifacts from [`rhinestonewtf/safe7579` commit `9f507f33b0f40d4c5f49f34565ddc7a12bd641cd`](https://github.com/rhinestonewtf/safe7579/tree/9f507f33b0f40d4c5f49f34565ddc7a12bd641cd/artifacts), `Safe7579Launchpad/Safe7579Launchpad.json` and `Safe7579/Safe7579.json`. The adapter is deployed through its actual constructor, which also creates its delegatecall utility. It is a local deployment of that public artifact; it is not presented as a copied Sepolia adapter runtime.
- `provenance.json` records fixture SHA-256 and source identity.

## Scope limits

The first setup test uses an empty validators/modules list and directly impersonates the supported EntryPoint. It deliberately bypasses `validateUserOp`, signatures, validator installation, gas estimation, bundler behavior, and the complete ERC-4337 lifecycle. The separate hash assertion includes a typed validator but does not invoke that validator. This is targeted Anvil EVM evidence, **not** a fork test, full integration-suite pass, or upstream CI/review approval.

Address and `erc7579Version` selection remain caller responsibility, as in PR #572; the validation adds no runtime guard.
