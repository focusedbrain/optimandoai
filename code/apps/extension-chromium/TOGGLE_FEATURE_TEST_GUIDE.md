# 🎯 Toggle Feature Testing Guide

## Branch: `feature/agent-box-toggles`

### ✅ Build Complete
The extension has been built successfully and is ready to test in the `dist/` folder.

---

## 🧪 How to Test

### 1. Load the Extension
1. Open Chrome/Edge
2. Go to `chrome://extensions` (or `edge://extensions`)
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select: `apps/extension-chromium/dist`

### 2. Test Individual Agent Box Toggles (Master Tabs)

#### Test Steps:
1. **Open any website** (e.g., google.com)
2. **Open the sidepanel** (click extension icon)
3. **Click "Add Agent Box"** button
4. **Fill in the form** and click "Save"
5. **Look at the agent box header** - you should see:
   - 📝 Title (fully visible)
   - 🟢 **GREEN TOGGLE** (ON position)
   - ✏️ Edit button
   - ✕ Delete button

#### What to Test:
- **Click the toggle** → Should turn gray and slide to OFF position
- **Agent box content** → Should fade to 50% opacity
- **Message changes** → "Agent disabled - toggle On to activate"
- **Title fades** → Should also be at 50% opacity
- **Notification appears** → Top-right corner shows "Agent disabled ✓"
- **Click again** → Toggle back ON, everything returns to normal
- **Refresh page** → Toggle state should be preserved!

---

### 3. Test Display Grid Toggles

#### Test Steps:
1. **Open the sidepanel**
2. **Click the "Add View" button** (➕ icon)
3. **Select "Display Grid Browser"**
4. **Choose a layout** (e.g., 2-slot, 3-slot, etc.)
5. **Click "Save & Open"**
6. **New window opens** with the display grid

#### What to Test - Master Toggle:
At the top of the grid window, you'll see:
- **Header bar** with "Display Grid: [layout]" and "Master Control"
- **Large green toggle** (44px wide)

**Click the master toggle:**
- ✅ All slot toggles turn OFF simultaneously
- ✅ All slots fade to 50% opacity
- ✅ Console logs "Master toggle: All slots disabled"
- ✅ Click again → Everything turns back ON

#### What to Test - Individual Slot Toggles:
Each slot has a toggle in its header (next to the edit button):

**Click a slot toggle:**
- ✅ That specific slot turns OFF (gray toggle)
- ✅ Slot content fades to 50% opacity
- ✅ Other slots remain unaffected
- ✅ Click again → Slot turns back ON

---

### 4. Test Auto-Enable on Creation

#### Test Steps:
1. **Create a new agent box** (via "Add Agent Box")
2. **Save the form**
3. **Check the toggle** → Should be GREEN (ON) by default
4. **Create another agent box** → Also ON by default
5. **Open a display grid** → All slots should start with toggles ON

---

### 5. Test State Persistence

#### Test Steps:
1. **Create 2-3 agent boxes**
2. **Toggle one OFF** and leave others ON
3. **Refresh the page** (F5)
4. **Check the states** → Should be exactly as you left them!

**For Display Grids:**
1. **Open a display grid**
2. **Toggle some slots OFF**
3. **Close the grid window**
4. **Open the same grid again** → States should persist

---

### 6. Test Session Restore

#### Test Steps:
1. **Create a session** with multiple agent boxes
2. **Toggle some ON and some OFF**
3. **Open Sessions History** (sidepanel)
4. **Click on the session** to restore it
5. **Check all toggle states** → Should be restored correctly!

---

## 🎨 Visual Indicators

### Toggle States:

**ON (Enabled):**
- Color: Green (`#4CAF50`)
- Knob position: Right side
- Agent box: Full opacity (100%)
- Message: "Ready for [Agent Name]..."

**OFF (Disabled):**
- Color: Gray (`#ccc`)
- Knob position: Left side
- Agent box: Reduced opacity (50%)
- Pointer events: Disabled
- Message: "Agent disabled - toggle On to activate"

---

## 🐛 What to Look For

### Expected Behaviors:
✅ Smooth 0.3s animations when toggling
✅ Clear visual feedback (color change + position change)
✅ Notifications appear briefly (2 seconds)
✅ State persists across refreshes
✅ Master toggle controls all slots in a grid
✅ Individual toggles work independently

### Potential Issues to Report:
❌ Toggle doesn't animate smoothly
❌ State doesn't persist after refresh
❌ Master toggle doesn't affect all slots
❌ Agent box doesn't fade when disabled
❌ Toggle state not saved to session

---

## 📝 Notes

- **Backend wiring is intentionally simplified** - the toggle is for UI/UX demonstration
- The complex logic to check if an agent box is the only user of an agent is NOT implemented yet
- This allows you to see and test the toggle concept before full backend integration

---

## 🚀 Quick Test Checklist

- [ ] Build successful
- [ ] Extension loaded in Chrome
- [ ] Individual agent box toggles work
- [ ] Toggle animations are smooth
- [ ] Disabled state shows correctly (opacity + message)
- [ ] Display grid master toggle works
- [ ] Individual slot toggles work independently
- [ ] State persists after refresh
- [ ] New agents start with toggle ON
- [ ] Session restore preserves toggle states
- [ ] Notifications appear on toggle

---

## 📞 Feedback

After testing, let me know:
1. Does the toggle feel natural and intuitive?
2. Are the animations smooth enough?
3. Is the visual feedback clear?
4. Any issues with state persistence?
5. Should the toggle size/position be adjusted?

Happy testing! 🎉

