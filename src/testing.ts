/**
 * テストで共通に使う値。
 */
import { parseConfig, type Config } from "./config.js";

export const MINIMAL_CONFIG = `
github:
  repo: owner/name
discord:
  channels:
    requirements: "1000000000000000001"
    questions: "1000000000000000002"
    notices: "1000000000000000003"
  allowed_users:
    - "2000000000000000001"
`;

export const ALLOWED_USER = "2000000000000000001";

export function testConfig(extraYaml = ""): Config {
  return parseConfig(MINIMAL_CONFIG + extraYaml);
}
