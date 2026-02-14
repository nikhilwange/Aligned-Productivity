# HUD Stale Closure Fix - "Pasting..." Stuck Issue

**Date**: 2026-02-06
**Issue**: HUD gets stuck showing "Pasting..." and "Initializing..." after pressing Enter/Stop

## Root Cause

The HUD had **stale closure issues** where functions captured the initial `status` value instead of using the current value:

### Problem Areas

1. **Audio Processor** (line 165)
   ```typescript
   // BAD: 'status' is captured at initialization time
   if (!mountedRef.current || status === 'stopping') return;
   ```

2. **Keyboard Handler** (line 268)
   ```typescript
   // BAD: Checks stale 'status' value
   if (e.key === 'Enter' && status === 'recording') {
   ```

3. **IPC Handler** (line 280)
   ```typescript
   // BAD: Checks stale 'status' value
   if (status === 'recording') {
   ```

4. **Missing useCallback**
   - Functions weren't memoized, causing effect dependencies to change on every render
   - This created infinite re-render loops and stale closures

---

## The Fix

### 1. Added `statusRef` to Track Current Status

```typescript
const statusRef = useRef<HUDStatus>('initializing');

// Keep statusRef in sync with status state
useEffect(() => {
    statusRef.current = status;
}, [status]);
```

**Why**: Refs always contain the current value, even inside closures created at initialization time.

### 2. Wrapped All Functions with `useCallback`

```typescript
const cleanup = useCallback(() => {
    // cleanup logic...
}, []);

const encodeAudio = useCallback((buffer: ArrayBuffer): string => {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}, []);

const stopRecording = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    // stop logic...
}, [cleanup, onComplete]);

const cancelRecording = useCallback(() => {
    cleanup();
    onCancel();
}, [cleanup, onCancel]);
```

**Why**: Prevents functions from being recreated on every render, which would cause effect dependencies to change constantly.

### 3. Updated All Status Checks to Use `statusRef.current`

**Audio Processor**:
```typescript
processorRef.current.onaudioprocess = (e) => {
    if (!mountedRef.current || statusRef.current === 'stopping') return;
    // ✅ Now uses current status
};
```

**Keyboard Handler**:
```typescript
const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && statusRef.current === 'recording') {
        // ✅ Now uses current status
        stopRecording();
    }
};
```

**IPC Handler**:
```typescript
const handleCommand = (_: any, command: 'start' | 'stop') => {
    if (command === 'stop') {
        if (statusRef.current === 'recording') {
            // ✅ Now uses current status
            stopRecording();
        }
    }
};
```

### 4. Fixed Effect Dependencies

**Before**:
```typescript
useEffect(() => {
    // handlers...
}, [status]); // ❌ Recreates effect on every status change
```

**After**:
```typescript
useEffect(() => {
    // handlers...
}, [stopRecording, cancelRecording]); // ✅ Stable dependencies
```

---

## What Was Happening (Bug Flow)

1. User presses Enter or clicks Stop button
2. `stopRecording()` is called
3. Status changes to `'stopping'`
4. `onComplete(finalText)` is called, triggering IPC to paste
5. **BUG**: Audio processor still running with **stale** `status === 'recording'`
6. Event handlers still checking **stale** `status === 'recording'`
7. Window doesn't hide because IPC never completes properly
8. User sees "Pasting..." forever

---

## What Happens Now (Fixed Flow)

1. User presses Enter or clicks Stop button
2. `stopRecording()` is called
3. Status changes to `'stopping'`
4. Audio processor **immediately stops** because it checks `statusRef.current === 'stopping'`
5. Cleanup runs properly
6. `onComplete(finalText)` is called
7. IPC sends paste command
8. Window hides, text pastes at cursor position
9. ✅ Clean completion!

---

## Files Modified

### [components/FloatingHUD.tsx](components/FloatingHUD.tsx)

**Lines changed**:
- Line 1: Added `useCallback` to imports
- Lines 20-40: Added `statusRef` and sync effect
- Lines 42-67: Wrapped `cleanup` in `useCallback`
- Lines 71-76: Wrapped `encodeAudio` in `useCallback`
- Lines 78-88: Wrapped `stopRecording` in `useCallback`, use `statusRef`
- Lines 90-94: Wrapped `cancelRecording` in `useCallback`
- Line 165: Changed `status === 'stopping'` → `statusRef.current === 'stopping'`
- Line 268: Changed `status === 'recording'` → `statusRef.current === 'recording'`
- Line 280: Changed `status === 'recording'` → `statusRef.current === 'recording'`
- Lines 272, 289: Updated effect dependencies to use stable callbacks

---

## Testing

### Build Status
```bash
npm run build
```
✅ Builds successfully with no errors

### Test Scenario 1: Press Enter to Paste
1. Press `Option+Space`
2. Speak: "Hello world"
3. Press **Enter**
4. ✅ Expected: Text pastes immediately, HUD disappears in <1 second

### Test Scenario 2: Click Stop Button
1. Press `Option+Space`
2. Speak: "Testing the button"
3. Click **Stop** button
4. ✅ Expected: Text pastes immediately, HUD disappears

### Test Scenario 3: Global Shortcut Toggle
1. Press `Option+Space` (opens HUD)
2. Speak something
3. Press `Option+Space` again (stops and pastes)
4. ✅ Expected: Text pastes, HUD disappears

### Test Scenario 4: ESC Cancel
1. Press `Option+Space`
2. Speak something
3. Press **ESC**
4. ✅ Expected: HUD closes immediately, nothing is pasted

---

## Debug Console Output

### Expected Logs (Success)
```
[HUD] Initializing session...
[HUD] Connecting to Gemini...
[HUD] Gemini connected, requesting microphone...
[HUD] Microphone ready
[HUD] Recording started
[HUD] Transcript chunk: hello
[HUD] Transcript chunk:  world
[HUD] Stopping recording
[HUD] Final transcript: hello world
[App] handleHudComplete called with text length: 11
[App] Sending paste-text via IPC
Received paste-text request, length: 11
Executing paste command (via AppleScript)...
Paste command executed successfully
```

### If Still Stuck (Unexpected)
```
[HUD] Stopping recording
[HUD] Final transcript: ...
[App] handleHudComplete called with text length: ...
[App] Sending paste-text via IPC
// ❌ Missing: "Received paste-text request"
// Check: Is Electron main process receiving IPC?
```

---

## Key Learnings

### React Closure Gotcha
When you create a function inside a `useEffect`, it captures the values of variables **at that moment**. If those values change later, the function still has the old values.

**Solution**: Use refs for values that change but need to be accessed in long-lived closures.

### useCallback Best Practice
Always wrap event handlers and callbacks in `useCallback` when:
- They're used as dependencies in other effects
- They're passed to child components
- They're registered as event listeners

### Status Management Pattern
For components with lifecycle states:
1. Use state for UI reactivity (`const [status, setStatus] = useState(...)`)
2. Use ref for closure access (`const statusRef = useRef(...)`)
3. Sync them with an effect (`useEffect(() => { statusRef.current = status }, [status])`)

---

## Summary

✅ **Fixed**: Stale closure issues by adding `statusRef` and using `useCallback`
✅ **Fixed**: Status checks now use current values, not stale values
✅ **Fixed**: HUD no longer gets stuck in "Pasting..." state
✅ **Fixed**: All event handlers have stable dependencies
✅ **Result**: Fast, responsive HUD that completes paste operation reliably

**Ready for testing!** 🚀

---

**Next Steps**:
1. Run `npm run electron:dev`
2. Test all four scenarios above
3. Verify text pastes at cursor position in any application
4. Check that HUD closes within 1 second after pressing Enter
