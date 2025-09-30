import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { parsePatch, applyPatch, type Hunk } from './ApplyPatch.ts';

describe('parsePatch', () => {
  it('should throw error for invalid patch format', () => {
    expect(() => parsePatch('bad')).toThrow("Patch must have at least begin and end markers");
    expect(() => parsePatch('*** Begin Patch\nbad')).toThrow("The last line of the patch must be '*** End Patch'");
  });

  it('should parse empty patch', () => {
    const patch = '*** Begin Patch\n*** End Patch';
    const hunks = parsePatch(patch);
    expect(hunks).toEqual([]);
  });

  it('should parse add file hunk', () => {
    const patch = `*** Begin Patch
*** Add File: path/add.py
+abc
+def
*** End Patch`;
    const hunks = parsePatch(patch);
    expect(hunks).toEqual([{
      type: 'add',
      path: 'path/add.py',
      contents: 'abc\ndef\n'
    }]);
  });

  it('should parse delete file hunk', () => {
    const patch = `*** Begin Patch
*** Delete File: path/delete.py
*** End Patch`;
    const hunks = parsePatch(patch);
    expect(hunks).toEqual([{
      type: 'delete',
      path: 'path/delete.py'
    }]);
  });

  it('should parse update file hunk with move', () => {
    const patch = `*** Begin Patch
*** Update File: path/update.py
*** Move to: path/update2.py
@@ def f():
-    pass
+    return 123
*** End Patch`;
    const hunks = parsePatch(patch);
    expect(hunks).toEqual([{
      type: 'update',
      path: 'path/update.py',
      movePath: 'path/update2.py',
      chunks: [{
        changeContext: 'def f():',
        oldLines: ['    pass'],
        newLines: ['    return 123'],
        isEndOfFile: false
      }]
    }]);
  });

  it('should parse multiple hunks', () => {
    const patch = `*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: file.py
@@
+line
*** Delete File: obsolete.txt
*** End Patch`;
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(3);
    expect(hunks[0].type).toBe('add');
    expect(hunks[1].type).toBe('update');
    expect(hunks[2].type).toBe('delete');
  });

  it('should parse update hunk without explicit context marker', () => {
    const patch = `*** Begin Patch
*** Update File: file2.py
 import foo
+bar
*** End Patch`;
    const hunks = parsePatch(patch);
    expect(hunks).toEqual([{
      type: 'update',
      path: 'file2.py',
      movePath: undefined,
      chunks: [{
        changeContext: undefined,
        oldLines: ['import foo'],
        newLines: ['import foo', 'bar'],
        isEndOfFile: false
      }]
    }]);
  });

  it('should throw error for empty update hunk', () => {
    const patch = `*** Begin Patch
*** Update File: test.py
*** End Patch`;
    expect(() => parsePatch(patch)).toThrow("Update file hunk for path 'test.py' is empty");
  });

  it('should throw error for invalid hunk header', () => {
    const patch = `*** Begin Patch
*** Invalid Header: test.py
*** End Patch`;
    expect(() => parsePatch(patch)).toThrow("Invalid hunk header: '*** Invalid Header: test.py'");
  });
});

describe('applyPatch', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'apply-patch-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create new file with add hunk', async () => {
    const filePath = 'add.txt';
    const patch = `*** Begin Patch
*** Add File: ${filePath}
+ab
+cd
*** End Patch`;
    
    const affected = await applyPatch(patch, tempDir);
    expect(affected).toEqual([`A ${filePath}`]);
    
    const content = await fs.readFile(path.join(tempDir, filePath), 'utf-8');
    expect(content).toBe('ab\ncd\n');
  });

  it('should delete existing file', async () => {
    const filePath = 'del.txt';
    const fullPath = path.join(tempDir, filePath);
    await fs.writeFile(fullPath, 'x');
    
    const patch = `*** Begin Patch
*** Delete File: ${filePath}
*** End Patch`;
    
    const affected = await applyPatch(patch, tempDir);
    expect(affected).toEqual([`D ${filePath}`]);
    
    await expect(fs.access(fullPath)).rejects.toThrow();
  });

  it('should update existing file content', async () => {
    const filePath = 'update.txt';
    const fullPath = path.join(tempDir, filePath);
    await fs.writeFile(fullPath, 'foo\nbar\n');
    
    const patch = `*** Begin Patch
*** Update File: ${filePath}
@@
 foo
-bar
+baz
*** End Patch`;
    
    const affected = await applyPatch(patch, tempDir);
    expect(affected).toEqual([`M ${filePath}`]);
    
    const content = await fs.readFile(fullPath, 'utf-8');
    expect(content).toBe('foo\nbaz\n');
  });

  it('should move and update file', async () => {
    const srcPath = 'src.txt';
    const destPath = 'dst.txt';
    const srcFullPath = path.join(tempDir, srcPath);
    const destFullPath = path.join(tempDir, destPath);
    await fs.writeFile(srcFullPath, 'line\n');
    
    const patch = `*** Begin Patch
*** Update File: ${srcPath}
*** Move to: ${destPath}
@@
-line
+line2
*** End Patch`;
    
    const affected = await applyPatch(patch, tempDir);
    expect(affected).toEqual([`M ${destPath}`]);
    
    await expect(fs.access(srcFullPath)).rejects.toThrow();
    const content = await fs.readFile(destFullPath, 'utf-8');
    expect(content).toBe('line2\n');
  });

  it('should handle context-based updates', async () => {
    const filePath = 'context.py';
    const fullPath = path.join(tempDir, filePath);
    await fs.writeFile(fullPath, `def func1():
    pass

def func2():
    old_code
    return 1
`);
    
    const patch = `*** Begin Patch
*** Update File: ${filePath}
@@ def func2():
-    old_code
+    new_code
*** End Patch`;
    
    const affected = await applyPatch(patch, tempDir);
    expect(affected).toEqual([`M ${filePath}`]);
    
    const content = await fs.readFile(fullPath, 'utf-8');
    expect(content).toContain('new_code');
    expect(content).not.toContain('old_code');
  });

  it('should throw error when pattern not found', async () => {
    const filePath = 'notfound.txt';
    const fullPath = path.join(tempDir, filePath);
    await fs.writeFile(fullPath, 'different content\n');
    
    const patch = `*** Begin Patch
*** Update File: ${filePath}
@@
-nonexistent line
+replacement
*** End Patch`;
    
    await expect(applyPatch(patch, tempDir)).rejects.toThrow('Failed to find expected lines');
  });

  it('should create parent directories for new files', async () => {
    const filePath = 'nested/deep/file.txt';
    const patch = `*** Begin Patch
*** Add File: ${filePath}
+content
*** End Patch`;
    
    const affected = await applyPatch(patch, tempDir);
    expect(affected).toEqual([`A ${filePath}`]);
    
    const content = await fs.readFile(path.join(tempDir, filePath), 'utf-8');
    expect(content).toBe('content\n');
  });
});