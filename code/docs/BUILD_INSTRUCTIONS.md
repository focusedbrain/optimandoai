# Quick Start: Build & Test Hardware Capability Check

## ⚡ 3-Minute Build Process

### 1. Close Stuck Terminal
Your terminal has a stuck vim/git process. Close that terminal window completely.

### 2. Open New PowerShell Terminal
```powershell
cd C:\Users\oscar\Documents\dev\optimandoai\code_clean\code
```

### 3. Build Extension (1 minute)
```powershell
cd apps\extension-chromium
npm run build
cd ..\..
```

### 4. Build Electron App (Optional - for later)
```powershell
cd apps\electron-vite-project
npm run build
```

---

## ✅ What You'll See

### Build Output
```
> @extension/chromium@1.0.0 build
> vite build

vite v4.x.x building for production...
✓ 1234 modules transformed.
dist/sidepanel.html                  x.xx kB
dist/assets/sidepanel-xxxxxx.js      xxx.xx kB
✓ built in x.xxs
```

### After Build
- Extension is ready at `apps/extension-chromium/dist/`
- New component: `HardwareWarningDialog.tsx` compiled ✅
- Ready to load in Chrome/Edge

---

## 🧪 Quick Test

### Test 1: Check Files Exist
```powershell
# Check new TypeScript files were created
ls apps\electron-vite-project\electron\main\llm\hardware-capability-check.ts
ls apps\extension-chromium\src\components\HardwareWarningDialog.tsx
ls apps\electron-vite-project\electron\main\llm\__tests__\hardware-capability.test.ts
```

**Expected:** All files exist ✅

### Test 2: Verify No Linting Errors
Already checked - **NO LINTING ERRORS** ✅

### Test 3: Load Extension
1. Open Chrome/Edge
2. Go to `chrome://extensions/` or `edge://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select `apps/extension-chromium/dist/`
6. Extension should load successfully

### Test 4: Check Console (After Integration)
After you integrate the patches:
1. Open extension sidepanel
2. Open Dev Tools → Console
3. Look for:
   ```
   [HardwareCapability] ===== CAPABILITY CHECK RESULTS =====
   [HardwareCapability] CPU: Intel Core...
   [HardwareCapability] AVX2: true/false
   [HardwareCapability] Profile: good/limited/too_old_for_local_llms
   ```

---

## 📝 Integration Checklist

After building, follow these steps:

- [ ] Build extension successfully
- [ ] Apply patches from `docs/PATCH_hardware_capability.txt` to `main.ts`
- [ ] Apply integration from `docs/INTEGRATION_sidepanel.tsx.txt` to `sidepanel.tsx`
- [ ] Rebuild Electron app
- [ ] Test on your PC
- [ ] Check logs for capability detection
- [ ] (Optional) Test on old PC to see warning dialog

---

## 🆘 Troubleshooting

### Issue: Build Fails
**Solution:** Make sure you're in the right directory
```powershell
pwd  # Should show: ...\code_clean\code
cd apps\extension-chromium
npm install  # If needed
npm run build
```

### Issue: TypeScript Errors
**Solution:** Already checked - no linting errors. If you see errors, they're likely from other files, not the new ones.

### Issue: Warning Dialog Doesn't Show
**Reason:** Your PC probably has good hardware (AVX2, enough RAM, SSD)

**To Test Warning:**
- Manually modify the API response to return `profile: 'too_old_for_local_llms'`
- OR test on an actual old PC (Intel Celeron, <6GB RAM, etc.)

### Issue: Can't Load Extension
**Solution:**
1. Make sure build completed successfully
2. Check `apps/extension-chromium/dist/` exists and has files
3. Try reloading the extension in Chrome

---

## 📊 What Happens on Different Hardware

### Your PC (Probably "good" or "limited")
```
CPU: Modern Intel/AMD with AVX2
RAM: 8GB+
Disk: SSD
→ Profile: "good"
→ No warning dialog
→ Local LLMs work great
```

### Old PC ("too_old_for_local_llms")
```
CPU: Intel Celeron/Pentium (no AVX2)
RAM: 4GB
Disk: HDD
→ Profile: "too_old_for_local_llms"
→ ⚠️ Warning dialog shows
→ Recommends Turbo Mode
→ Local mode still available (slow)
```

---

## 🎯 Success Criteria

After building, you should have:

✅ No build errors  
✅ Extension loads in Chrome/Edge  
✅ New files compiled into `dist/`  
✅ Ready for integration (just need to apply patches)  

---

## 📞 Next Actions

1. **Build now** (see Step 3 above)
2. **Apply patches** when ready to integrate
3. **Test** on your hardware
4. **Deploy** when satisfied

---

**Build Time:** ~1 minute  
**Integration Time:** ~5 minutes  
**Total Time to Production:** ~6 minutes

---

Ready to build? Just run:

```powershell
cd apps\extension-chromium
npm run build
```

🚀 Let's go!










