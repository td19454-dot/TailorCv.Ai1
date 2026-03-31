# Fix: Frontend Not Loading on Render

## Problem
When deploying to Render, only the FastAPI backend API endpoints work, but the HTML/CSS/JS frontend doesn't load.

## Root Causes
1. **Relative paths** - FastAPI was using relative paths that don't work in Render's environment
2. **Missing files** - Static files and templates might not be committed to git
3. **Path resolution** - Render's working directory might differ from local

## Solution Applied ✅

### 1. Updated `main.py` to use absolute paths
The code now uses `BASE_DIR` to resolve paths correctly:
```python
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
templates_dir = os.path.join(BASE_DIR, "templates")
static_dir = os.path.join(BASE_DIR, "static")
```

### 2. Added health check endpoint
Visit `/health` to verify files are being found:
- Shows if templates and static directories exist
- Lists files in each directory
- Helps debug deployment issues

## Steps to Fix Your Deployment

### Step 1: Verify Files Are Committed to Git

Check if your `templates/` and `static/` folders are in git:

```bash
git status
git ls-files templates/
git ls-files static/
```

If they're missing, add them:

```bash
git add templates/
git add static/
git commit -m "Add templates and static files"
git push
```

### Step 2: Verify .gitignore

Make sure `.gitignore` is NOT ignoring these directories. Check that you don't have:
```
templates/
static/
*.html
*.css
*.js
```

### Step 3: Check Render Build Logs

1. Go to your Render dashboard
2. Click on your service
3. Go to "Logs" tab
4. Look for errors about missing files

### Step 4: Test the Health Endpoint

After deployment, visit:
```
https://your-app.onrender.com/health
```

This will show you:
- Whether directories exist
- What files are found
- Path information

### Step 5: Verify Static Files Are Accessible

Try accessing static files directly:
```
https://your-app.onrender.com/static/css/style.css
https://your-app.onrender.com/static/js/main.js
```

If these return 404, the static files aren't being served.

## Common Issues & Fixes

### Issue 1: Files Not Committed
**Symptom**: Health endpoint shows empty file lists
**Fix**: 
```bash
git add templates/ static/
git commit -m "Add frontend files"
git push
```

### Issue 2: Wrong Working Directory
**Symptom**: Health endpoint shows wrong paths
**Fix**: The absolute path fix in `main.py` should resolve this

### Issue 3: Build Fails
**Symptom**: Render build fails
**Fix**: Check `requirements.txt` includes all dependencies:
```bash
pip install -r requirements.txt
```

### Issue 4: Static Files Return 404
**Symptom**: CSS/JS files don't load
**Fix**: 
1. Verify files exist in git
2. Check Render logs
3. Ensure `app.mount("/static", ...)` is before route definitions

## Verification Checklist

After deploying, verify:

- [ ] `/health` endpoint works and shows files
- [ ] `/` shows the landing page (not JSON)
- [ ] `/solutions` shows the solutions page
- [ ] `/static/css/style.css` loads (view source)
- [ ] `/static/js/main.js` loads (view source)
- [ ] Browser console shows no 404 errors
- [ ] CSS styling is applied
- [ ] JavaScript functions work

## Quick Test Commands

```bash
# Test locally first
python main.py

# Then check:
curl http://localhost:8000/health
curl http://localhost:8000/
curl http://localhost:8000/static/css/style.css
```

## If Still Not Working

1. **Check Render Logs**: Look for Python errors
2. **Check Browser Console**: Look for 404s or CORS errors
3. **Check Network Tab**: See what requests are failing
4. **Test Health Endpoint**: Verify file paths
5. **Verify Git**: Ensure all files are committed

## Additional Debugging

Add this temporary route to see what's happening:

```python
@app.get("/debug")
async def debug():
    import os
    return {
        "cwd": os.getcwd(),
        "base_dir": BASE_DIR,
        "files_in_root": os.listdir(BASE_DIR),
        "templates": os.listdir(templates_dir) if os.path.exists(templates_dir) else "NOT FOUND",
        "static": os.listdir(static_dir) if os.path.exists(static_dir) else "NOT FOUND"
    }
```

Then visit `/debug` to see what Render sees.
