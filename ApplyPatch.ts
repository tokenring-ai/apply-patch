import * as fs from 'fs';
import * as path from 'path';

export interface ApplyPatchError extends Error {
  status?: number;
  hint?: string;
  details?: string;
}

export type Hunk = 
  | { type: 'add'; path: string; contents: string }
  | { type: 'delete'; path: string }
  | { type: 'update'; path: string; movePath?: string; chunks: UpdateFileChunk[] };

export interface UpdateFileChunk {
  changeContext?: string;
  oldLines: string[];
  newLines: string[];
  isEndOfFile: boolean;
}

const BEGIN_PATCH_MARKER = "*** Begin Patch";
const END_PATCH_MARKER = "*** End Patch";
const ADD_FILE_MARKER = "*** Add File: ";
const DELETE_FILE_MARKER = "*** Delete File: ";
const UPDATE_FILE_MARKER = "*** Update File: ";
const MOVE_TO_MARKER = "*** Move to: ";
const EOF_MARKER = "*** End of File";
const CHANGE_CONTEXT_MARKER = "@@ ";
const EMPTY_CHANGE_CONTEXT_MARKER = "@@";

export function parsePatch(patch: string): Hunk[] {
  const lines = patch.trim().split('\n');
  
  if (lines.length < 2) {
    throw createError("Patch must have at least begin and end markers", 400);
  }
  
  if (lines[0] !== BEGIN_PATCH_MARKER) {
    throw createError("The first line of the patch must be '*** Begin Patch'", 400);
  }
  
  if (lines[lines.length - 1] !== END_PATCH_MARKER) {
    throw createError("The last line of the patch must be '*** End Patch'", 400);
  }

  const hunks: Hunk[] = [];
  let i = 1;
  
  while (i < lines.length - 1) {
    const [hunk, consumed] = parseOneHunk(lines, i);
    hunks.push(hunk);
    i += consumed;
  }
  
  return hunks;
}

function parseOneHunk(lines: string[], startIndex: number): [Hunk, number] {
  const line = lines[startIndex].trim();
  
  if (line.startsWith(ADD_FILE_MARKER)) {
    const filePath = line.substring(ADD_FILE_MARKER.length);
    let contents = '';
    let i = startIndex + 1;
    
    while (i < lines.length && lines[i].startsWith('+')) {
      contents += lines[i].substring(1) + '\n';
      i++;
    }
    
    return [{ type: 'add', path: filePath, contents }, i - startIndex];
  }
  
  if (line.startsWith(DELETE_FILE_MARKER)) {
    const filePath = line.substring(DELETE_FILE_MARKER.length);
    return [{ type: 'delete', path: filePath }, 1];
  }
  
  if (line.startsWith(UPDATE_FILE_MARKER)) {
    const filePath = line.substring(UPDATE_FILE_MARKER.length);
    let i = startIndex + 1;
    let movePath: string | undefined;
    
    // Check for move directive
    if (i < lines.length && lines[i].startsWith(MOVE_TO_MARKER)) {
      movePath = lines[i].substring(MOVE_TO_MARKER.length);
      i++;
    }
    
    const chunks: UpdateFileChunk[] = [];
    
    while (i < lines.length && !lines[i].startsWith('***')) {
      if (lines[i].trim() === '') {
        i++;
        continue;
      }
      
      const [chunk, consumed] = parseUpdateFileChunk(lines, i);
      chunks.push(chunk);
      i += consumed;
    }
    
    if (chunks.length === 0) {
      throw createError(`Update file hunk for path '${filePath}' is empty`, 400);
    }
    
    return [{ type: 'update', path: filePath, movePath, chunks }, i - startIndex];
  }
  
  throw createError(`Invalid hunk header: '${line}'`, 400);
}

function parseUpdateFileChunk(lines: string[], startIndex: number): [UpdateFileChunk, number] {
  let i = startIndex;
  let changeContext: string | undefined;
  
  // Parse context marker
  if (lines[i] === EMPTY_CHANGE_CONTEXT_MARKER) {
    changeContext = undefined;
    i++;
  } else if (lines[i].startsWith(CHANGE_CONTEXT_MARKER)) {
    changeContext = lines[i].substring(CHANGE_CONTEXT_MARKER.length);
    i++;
  }
  
  const chunk: UpdateFileChunk = {
    changeContext,
    oldLines: [],
    newLines: [],
    isEndOfFile: false
  };
  
  let hasContent = false;
  
  while (i < lines.length) {
    const line = lines[i];
    
    if (line === EOF_MARKER) {
      chunk.isEndOfFile = true;
      i++;
      break;
    }
    
    if (line.startsWith('***') || line.startsWith('@@')) {
      break;
    }
    
    const prefix = line[0];
    const content = line.substring(1);
    
    if (prefix === ' ') {
      chunk.oldLines.push(content);
      chunk.newLines.push(content);
      hasContent = true;
    } else if (prefix === '-') {
      chunk.oldLines.push(content);
      hasContent = true;
    } else if (prefix === '+') {
      chunk.newLines.push(content);
      hasContent = true;
    } else if (line.trim() === '') {
      chunk.oldLines.push('');
      chunk.newLines.push('');
      hasContent = true;
    } else {
      if (!hasContent) {
        throw createError(`Unexpected line in update hunk: '${line}'`, 400);
      }
      break;
    }
    
    i++;
  }
  
  return [chunk, i - startIndex];
}

export async function applyPatch(patch: string, cwd: string = process.cwd()): Promise<string[]> {
  const hunks = parsePatch(patch);
  const affectedFiles: string[] = [];
  
  for (const hunk of hunks) {
    const fullPath = path.resolve(cwd, hunk.path);
    
    switch (hunk.type) {
      case 'add':
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, hunk.contents);
        affectedFiles.push(`A ${hunk.path}`);
        break;
        
      case 'delete':
        await fs.promises.unlink(fullPath);
        affectedFiles.push(`D ${hunk.path}`);
        break;
        
      case 'update':
        const newContent = await applyUpdateChunks(fullPath, hunk.chunks);
        
        if (hunk.movePath) {
          const newFullPath = path.resolve(cwd, hunk.movePath);
          await fs.promises.mkdir(path.dirname(newFullPath), { recursive: true });
          await fs.promises.writeFile(newFullPath, newContent);
          await fs.promises.unlink(fullPath);
          affectedFiles.push(`M ${hunk.movePath}`);
        } else {
          await fs.promises.writeFile(fullPath, newContent);
          affectedFiles.push(`M ${hunk.path}`);
        }
        break;
    }
  }
  
  return affectedFiles;
}

async function applyUpdateChunks(filePath: string, chunks: UpdateFileChunk[]): Promise<string> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  let lines = content.split('\n');
  
  // Remove trailing empty line if present
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  
  const replacements: Array<{ start: number; length: number; newLines: string[] }> = [];
  let searchStart = 0;
  
  for (const chunk of chunks) {
    if (chunk.changeContext) {
      const contextIndex = seekSequence(lines, [chunk.changeContext], searchStart);
      if (contextIndex !== null) {
        searchStart = contextIndex + 1;
      }
    }
    
    if (chunk.oldLines.length === 0) {
      // Pure addition
      const insertIndex = lines.length;
      replacements.push({ start: insertIndex, length: 0, newLines: chunk.newLines });
      continue;
    }
    
    let pattern = chunk.oldLines;
    let newLines = chunk.newLines;
    
    // Handle end-of-file patterns
    if (pattern[pattern.length - 1] === '' && !chunk.isEndOfFile) {
      pattern = pattern.slice(0, -1);
      if (newLines[newLines.length - 1] === '') {
        newLines = newLines.slice(0, -1);
      }
    }
    
    const matchIndex = seekSequence(lines, pattern, searchStart);
    if (matchIndex === null) {
      throw createError(`Failed to find expected lines:\n${pattern.join('\n')}`, 400);
    }
    
    replacements.push({ start: matchIndex, length: pattern.length, newLines });
    searchStart = matchIndex + pattern.length;
  }
  
  // Apply replacements in reverse order
  replacements.sort((a, b) => b.start - a.start);
  
  for (const replacement of replacements) {
    lines.splice(replacement.start, replacement.length, ...replacement.newLines);
  }
  
  // Ensure file ends with newline
  if (lines.length > 0 && lines[lines.length - 1] !== '') {
    lines.push('');
  }
  
  return lines.join('\n');
}

function seekSequence(lines: string[], pattern: string[], start: number): number | null {
  if (pattern.length === 0) return start;
  if (pattern.length > lines.length) return null;
  
  for (let i = start; i <= lines.length - pattern.length; i++) {
    let match = true;
    
    // Try exact match first
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    
    if (match) return i;
    
    // Try trimmed match
    match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (lines[i + j].trim() !== pattern[j].trim()) {
        match = false;
        break;
      }
    }
    
    if (match) return i;
  }
  
  return null;
}

function createError(message: string, status?: number, hint?: string): ApplyPatchError {
  const error = new Error(message) as ApplyPatchError;
  error.status = status;
  error.hint = hint;
  return error;
}