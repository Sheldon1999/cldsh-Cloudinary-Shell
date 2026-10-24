import readline from 'node:readline';
import process from 'node:process';
import {
  actionList,
  actionUpload,
  actionInfo,
  actionDelete,
  actionUrl,
  actionMove,
  actionTree,
  actionDownload,
} from './actions/index.js';

export const MCP_TOOLS = [
  {
    name: 'cloudinary_list',
    description: 'List folders and media assets in Cloudinary. Supports filtering by resource_type and wildcards/globs (e.g. cld*, *.png).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Folder path or wildcard pattern (e.g. "portfolio", "cld*", "*.png")',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type to list (default: "image")',
        },
        max: {
          type: 'number',
          description: 'Max results to return (default: 200)',
        },
      },
    },
  },
  {
    name: 'cloudinary_upload',
    description: 'Upload a local file or directory into Cloudinary. Supports recursive uploads, concurrency, collision handling, and dry-run.',
    inputSchema: {
      type: 'object',
      properties: {
        local_path: {
          type: 'string',
          description: 'Absolute or relative local file/directory path to upload',
        },
        name: {
          type: 'string',
          description: 'Custom public ID for single file upload (defaults to filename without extension)',
        },
        folder: {
          type: 'string',
          description: 'Target Cloudinary folder destination',
        },
        recursive: {
          type: 'boolean',
          description: 'If true and local_path is a directory, recursively mirrors subfolders into Cloudinary',
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite existing assets (default: true)',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview planned uploads without modifying Cloudinary',
        },
      },
      required: ['local_path'],
    },
  },
  {
    name: 'cloudinary_get_url',
    description: 'Generate optimized CDN delivery URLs for Cloudinary assets, with optional on-the-fly transformations (e.g. f_auto,q_auto,w_800).',
    inputSchema: {
      type: 'object',
      properties: {
        public_id: {
          type: 'string',
          description: 'Public ID, full path, or wildcard pattern of the asset',
        },
        transformation: {
          type: 'string',
          description: 'Cloudinary transformation string (e.g. "f_auto,q_auto", "w_800,c_limit", "c_fill,w_300,h_300,g_face")',
        },
        signed: {
          type: 'boolean',
          description: 'Generate cryptographic signed delivery URL for authenticated/private assets',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
      },
      required: ['public_id'],
    },
  },
  {
    name: 'cloudinary_info',
    description: 'Inspect complete technical metadata for an asset (dimensions, bytes, format, created timestamp, tags, version, CDN URLs).',
    inputSchema: {
      type: 'object',
      properties: {
        public_id: {
          type: 'string',
          description: 'Public ID or full path of the asset',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
      },
      required: ['public_id'],
    },
  },
  {
    name: 'cloudinary_delete',
    description: 'Delete an asset or folder in Cloudinary. Supports single asset, recursive folder purge, and wildcards.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Asset public ID, folder path, or wildcard pattern to delete',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to recursively delete a folder and all nested assets (PURGE)',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview deletions without modifying or deleting assets',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'cloudinary_move',
    description: 'Rename an asset or move it across Cloudinary virtual folders.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Current public ID of the asset',
        },
        target: {
          type: 'string',
          description: 'New public ID or target folder path ending with /',
        },
        overwrite: {
          type: 'boolean',
          description: 'Overwrite target asset if it already exists (default: false)',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview rename without executing',
        },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'cloudinary_tree',
    description: 'Get directory tree hierarchy of Cloudinary folders.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Root folder to start tree inspection (default: root "/")',
        },
        depth: {
          type: 'number',
          description: 'Max hierarchy depth to traverse (default: infinite)',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
      },
    },
  },
  {
    name: 'cloudinary_download',
    description: 'Download an asset from Cloudinary to the local machine.',
    inputSchema: {
      type: 'object',
      properties: {
        public_id: {
          type: 'string',
          description: 'Asset public ID or wildcard pattern to download',
        },
        destination: {
          type: 'string',
          description: 'Local destination file or directory path (defaults to current directory)',
        },
        resource_type: {
          type: 'string',
          enum: ['image', 'video', 'raw'],
          description: 'Resource type (default: "image")',
        },
      },
      required: ['public_id'],
    },
  },
];

export async function handleMcpToolCall(name, args = {}, ctx = {}) {
  const cwd = ctx.cwd || '';

  switch (name) {
    case 'cloudinary_list': {
      return actionList(args.path || '', {
        cwd,
        resourceType: args.resource_type || 'image',
        max: args.max !== undefined ? Number(args.max) : 200,
      });
    }

    case 'cloudinary_upload': {
      return actionUpload(args.local_path, {
        name: args.name,
        cwd: args.folder || cwd,
        recursive: Boolean(args.recursive),
        overwrite: args.overwrite !== undefined ? Boolean(args.overwrite) : true,
        resourceType: args.resource_type || 'image',
        dryRun: Boolean(args.dry_run),
      });
    }

    case 'cloudinary_get_url': {
      return actionUrl(args.public_id, {
        cwd,
        transformation: args.transformation,
        signed: Boolean(args.signed),
        resourceType: args.resource_type || 'image',
      });
    }

    case 'cloudinary_info': {
      return actionInfo(args.public_id, {
        cwd,
        resourceType: args.resource_type || 'image',
      });
    }

    case 'cloudinary_delete': {
      return actionDelete(args.target, {
        cwd,
        recursive: Boolean(args.recursive),
        resourceType: args.resource_type || 'image',
        dryRun: Boolean(args.dry_run),
      });
    }

    case 'cloudinary_move': {
      return actionMove(args.source, args.target, {
        cwd,
        resourceType: args.resource_type || 'image',
        overwrite: Boolean(args.overwrite),
        dryRun: Boolean(args.dry_run),
      });
    }

    case 'cloudinary_tree': {
      return actionTree(args.folder || '', {
        cwd,
        depth: args.depth !== undefined ? Number(args.depth) : Infinity,
        resourceType: args.resource_type || 'image',
      });
    }

    case 'cloudinary_download': {
      return actionDownload(args.public_id, {
        destination: args.destination,
        cwd,
        resourceType: args.resource_type || 'image',
      });
    }

    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export async function handleMcpMessage(request, ctx = {}) {
  if (!request || typeof request !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error: invalid JSON' },
    };
  }

  const { id, method, params } = request;

  // 1. initialize
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: 'cloudinary-shell',
          version: '1.0.0',
        },
      },
    };
  }

  // 2. notifications/initialized (notification -> no response)
  if (method === 'notifications/initialized') {
    return null;
  }

  // 3. ping
  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: {},
    };
  }

  // 4. tools/list
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS,
      },
    };
  }

  // 4b. resources/list & prompts/list (inspector compatibility)
  if (method === 'resources/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { resources: [] },
    };
  }
  if (method === 'prompts/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { prompts: [] },
    };
  }
  if (method === 'resources/templates/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { resourceTemplates: [] },
    };
  }

  // 5. tools/call
  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    try {
      const data = await handleMcpToolCall(toolName, toolArgs, ctx);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        },
      };
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error: ${e?.message || String(e)}`,
            },
          ],
        },
      };
    }
  }

  // Unknown method
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

export async function runMcpServer(ctx = {}) {
  // Direct all logs to stderr to maintain stdout purity for JSON-RPC
  process.stderr.write('Starting Cloudinary Shell (cldsh) Native MCP Server over stdio...\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      const errResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
      return;
    }

    try {
      const response = await handleMcpMessage(request, ctx);
      if (response !== null) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (e) {
      const errResponse = {
        jsonrpc: '2.0',
        id: request?.id || null,
        error: { code: -32603, message: e?.message || 'Internal error' },
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
    }
  });

  process.on('SIGINT', () => {
    process.stderr.write('MCP Server exiting on SIGINT.\n');
    process.exit(0);
  });
}
