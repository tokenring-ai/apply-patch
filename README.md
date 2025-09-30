# Apply Patch Package Documentation

## Overview

The `@tokenring-ai/apply-patch` package provides a TypeScript implementation of the OpenAI Codex file-oriented diff format for safe code editing. It converts the original Rust implementation to native TypeScript, offering a stripped-down, easy-to-parse patch format designed for AI-assisted code modifications.

The package enables parsing and applying patches that can add, delete, or update files using a structured format with clear operation headers and context-aware hunks. It's designed to be safe and predictable for AI agents to generate and apply code changes.

## Installation/Setup

This package is in native TypeScript with no compiled .js version. To use it:

1. Ensure you have Node.js (v20+) for native type support, or alternatively, Bun or tsc installed.
2. Install dependencies in the root project:
   ```
   npm install
   ```
3. Import and use the functions in your code (see Usage Examples).

No additional setup is required; it uses native Node.js APIs for file operations.

## Package Structure

- `index.ts`: Entry point exporting main functions and types
- `ApplyPatch.ts`: Core implementation with parsing and application logic
- `instructions.ts`: Tool instructions for AI agents
- `package.json`: Package metadata and dependencies
- `README.md`: This documentation file

## Core Components

### Main Functions

- **`parsePatch(patch: string): Hunk[]`**
  - Parses a patch string into an array of hunks
  - Validates patch format and structure
  - Throws `ApplyPatchError` for invalid patches

- **`applyPatch(patch: string, cwd?: string): Promise<string[]>`**
  - Applies a patch to the filesystem
  - Returns array of affected files with status (A/M/D)
  - Uses current working directory by default

### Types

- **`Hunk`**: Union type for different patch operations
  - `{ type: 'add'; path: string; contents: string }`
  - `{ type: 'delete'; path: string }`
  - `{ type: 'update'; path: string; movePath?: string; chunks: UpdateFileChunk[] }`

- **`UpdateFileChunk`**: Represents a change within an update operation
  - `changeContext?: string`: Optional context line (e.g., function/class name)
  - `oldLines: string[]`: Lines to be replaced
  - `newLines: string[]`: Replacement lines
  - `isEndOfFile: boolean`: Whether chunk is at end of file

- **`ApplyPatchError`**: Extended Error with additional properties
  - `status?: number`: HTTP-style status code
  - `hint?: string`: Helpful error message
  - `details?: string`: Additional error details

## Usage Examples

### Basic Patch Application

```typescript
import { applyPatch, parsePatch } from '@tokenring-ai/apply-patch';

const patch = `*** Begin Patch
*** Add File: hello.txt
+Hello, world!
*** End Patch`;

// Parse the patch
const hunks = parsePatch(patch);
console.log(hunks); // [{ type: 'add', path: 'hello.txt', contents: 'Hello, world!\n' }]

// Apply the patch
const affectedFiles = await applyPatch(patch, '/path/to/project');
console.log(affectedFiles); // ['A hello.txt']
```

### Update File with Context

```typescript
const updatePatch = `*** Begin Patch
*** Update File: src/app.ts
@@ function greet()
-  console.log("Hi");
+  console.log("Hello, world!");
*** End Patch`;

const affectedFiles = await applyPatch(updatePatch);
console.log(affectedFiles); // ['M src/app.ts']
```

### File Move Operation

```typescript
const movePatch = `*** Begin Patch
*** Update File: old-name.ts
*** Move to: new-name.ts
@@
 // existing content
+// new content
*** End Patch`;

const affectedFiles = await applyPatch(movePatch);
console.log(affectedFiles); // ['M new-name.ts']
```

## Patch Format

The patch format uses a structured envelope:

```
*** Begin Patch
[file operations]
*** End Patch
```

### File Operations

1. **Add File**: Creates a new file
   ```
   *** Add File: path/to/file.txt
   +Line 1 content
   +Line 2 content
   ```

2. **Delete File**: Removes an existing file
   ```
   *** Delete File: path/to/file.txt
   ```

3. **Update File**: Modifies existing file (optionally with rename)
   ```
   *** Update File: path/to/file.txt
   *** Move to: path/to/new-file.txt  # Optional
   @@ optional context
   -old line
   +new line
    unchanged line
   ```

### Hunk Format

Within update operations, hunks use diff-style prefixes:
- ` ` (space): Context line (unchanged)
- `-`: Line to remove
- `+`: Line to add
- `@@`: Context marker (optional function/class name)

## Configuration Options

The package uses minimal configuration:

- **Working Directory**: Specify via `cwd` parameter in `applyPatch()`
- **Error Handling**: Throws `ApplyPatchError` with structured error information
- **File Paths**: Must be relative paths (absolute paths not supported)

## API Reference

### Functions

- `parsePatch(patch: string): Hunk[]`
- `applyPatch(patch: string, cwd?: string): Promise<string[]>`

### Constants

- `APPLY_PATCH_TOOL_INSTRUCTIONS`: Complete tool usage instructions for AI agents

### Types

- `Hunk`: Union type for patch operations
- `UpdateFileChunk`: Chunk within update operations
- `ApplyPatchError`: Extended error type

## Dependencies

Dev dependencies: `vitest@^3.2.4`, `@vitest/coverage-v8@^3.2.4`

## Contributing/Notes

- **Testing**: Run `npm test` for unit tests with coverage
- **Error Handling**: All errors include helpful messages and status codes
- **File Safety**: Operations are atomic where possible
- **Path Handling**: Only relative paths supported for security
- **License**: Apache 2.0 (see LICENSE)

This TypeScript implementation maintains compatibility with the original Rust version while providing native Node.js integration
