# Quick Fix: Frontend Not Loading on Render

## The Problem
Render is only serving the FastAPI backend API, but not the HTML/CSS/JS frontend.

## Most Likely Cause
Your `templates/` and `static/` folders are **not committed to Git**, so Render doesn't have them.

## Quick Fix (3 Steps)

### Step 1: Check if files are in Git

Open terminal in your project folder and run:

```bash
git status templates/
git status static/
```

If you see "Untracked files", they're not committed.

### Step 2: Add and Commit Files

```bash
git add templates/
git add static/
git commit -m "Add frontend templates and static files"
git push
```

### Step 3: Redeploy on Render

1. Go to Render dashboard
2. Your service should auto-redeploy when you push
3. Or manually click "Manual Deploy" → "Deploy latest commit"

## Verify It Works

After deployment, visit:
- `https://your-app.onrender.com/` - Should show landing page (not JSON)
- `https://your-app.onrender.com/health` - Should show files listed
- `https://your-app.onrender.com/static/css/style.css` - Should show CSS code

## If Still Not Working

### Check Render Logs
1. Go to Render dashboard → Your service → Logs
2. Look for errors about missing files or paths

### Test Health Endpoint
Visit: `https://your-app.onrender.com/health`

This will show:
- ✅ If templates directory exists
- ✅ If static directory exists  
- ✅ List of files found

### Common Issues

**Issue**: Health shows empty file lists
**Fix**: Files not committed to git - do Step 2 above

**Issue**: Health shows "NOT FOUND"
**Fix**: Check Render build logs for errors

**Issue**: Static files return 404
**Fix**: 
1. Verify files are committed (git ls-files static/)
2. Check that `app.mount("/static", ...)` is in main.py
3. Redeploy

## What I Fixed in main.py

✅ Changed from relative paths to absolute paths:
```python
# Before (doesn't work on Render)
app.mount("/static", StaticFiles(directory="static"), name="static")

# After (works on Render)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
static_dir = os.path.join(BASE_DIR, "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")
```

✅ Added `/health` endpoint to debug file paths

## Still Need Help?

1. Check `/health` endpoint output
2. Share the output with me
3. Check browser console (F12) for errors
4. Check Render logs for Python errors
