import { open } from 'node:fs/promises';
import {
  AdministratorError,
  AuthStore,
  MAX_PASSWORD_LENGTH,
  validatePassword,
  validateUsername,
} from '../server/auth.ts';

const usage = '用法：node scripts/init-admin.ts --password-file <路径> [--username <用户名>]';

function parseArguments(args: string[]): { passwordFile: string; username: string } {
  let passwordFile: string | undefined;
  let username = 'admin';
  let usernameProvided = false;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new AdministratorError(usage);
    if (option === '--password-file' && passwordFile === undefined) {
      passwordFile = value;
    } else if (option === '--username' && !usernameProvided) {
      username = value;
      usernameProvided = true;
    } else {
      throw new AdministratorError(usage);
    }
  }
  if (passwordFile === undefined) throw new AdministratorError(usage);
  validateUsername(username);
  return { passwordFile, username };
}

async function readPassword(path: string): Promise<string> {
  let contents: Buffer;
  try {
    const file = await open(path, 'r');
    try {
      const information = await file.stat();
      if (!information.isFile()) throw new AdministratorError('密码文件必须为普通文件');
      if (information.size > MAX_PASSWORD_LENGTH * 4 + 2) {
        throw new AdministratorError('密码文件过大，密码最多为 1024 个字符');
      }
      contents = await file.readFile();
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof AdministratorError) throw error;
    throw new AdministratorError('无法读取密码文件，请检查路径及权限');
  }
  const password = contents.toString('utf8').replace(/\r?\n$/, '');
  validatePassword(password);
  return password;
}

async function main(): Promise<void> {
  const { passwordFile, username } = parseArguments(process.argv.slice(2));
  const password = await readPassword(passwordFile);
  let store: AuthStore;
  try {
    store = new AuthStore();
  } catch {
    throw new AdministratorError('无法打开数据库，请检查数据目录及权限');
  }
  try {
    await store.initializeAdministrator(username, password);
  } finally {
    store.close();
  }
  console.log('管理员初始化成功');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof AdministratorError ? error.message : '管理员初始化失败');
  process.exitCode = 1;
}
