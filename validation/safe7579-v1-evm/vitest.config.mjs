import { fileURLToPath } from "node:url"
export default {
  root: fileURLToPath(new URL("../../", import.meta.url)),
  test: { include: ["validation/safe7579-v1-evm/real-evm.test.ts"], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false, pool: "forks" }
}
