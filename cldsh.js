#!/usr/bin/env node
import process from 'node:process';
import { main } from './lib/main.js';

await main(process.argv.slice(2));
