const isTTY = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;

const wrap = (open: string, close: string) => (s: string) =>
  isTTY ? `\x1b[${open}m${s}\x1b[${close}m` : s;

export const c = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  blue: wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan: wrap("36", "39"),
  gray: wrap("90", "39"),
};

const tag = c.bold(c.magenta("descriptor"));

export const log = {
  step(msg: string): void {
    console.log(`${tag} ${c.cyan("›")} ${msg}`);
  },
  info(msg: string): void {
    console.log(`${tag} ${c.blue("ℹ")} ${msg}`);
  },
  success(msg: string): void {
    console.log(`${tag} ${c.green("✓")} ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`${tag} ${c.yellow("⚠")} ${msg}`);
  },
  error(msg: string): void {
    console.error(`${tag} ${c.red("✗")} ${msg}`);
  },
  detail(msg: string): void {
    console.log(`  ${c.gray(msg)}`);
  },
};
