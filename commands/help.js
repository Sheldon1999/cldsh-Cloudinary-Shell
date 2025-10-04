import { println, strong, dim } from '../lib/printer.js';

export default async function help(_ctx) {
  println(strong('Commands:'));
  println('  help                      Show this help');
  println('  ls [-l] [--rt=image]      List folders/files in current folder');
  println('  cd <folder|..|/|->        Change folder (.. up, / root, - previous)');
  println('  mkdir <name>              Create a subfolder');
  println('  upload <path> <name> [-o] [--rt=image]  Upload file as <name>');
  println('  rm <name|public_id>       Remove a single asset');
  println('  rm -rf <folder>           Remove a folder and all contents');
  println('  pwd                        Show current folder path');
  println('  tree [-d N] [--rt=image]  Show folder tree (depth N)');
  println('  exit | quit               Exit the shell');
  println('\nFlags:');
  println('  -l         Long listing (size & dimensions) for ls');
  println('  -o         Overwrite on upload (default true)');
  println('  --rt=...   Resource type: image | video | raw');
  println('  -d N       Max depth for tree (default infinite)');
  println('\nTips:');
  println('  Use folders like namespaces: apps/your-app/dev/images');
  println(dim('  Credentials come from .env or environment variables.'));
}
