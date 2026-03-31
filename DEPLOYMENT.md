# Deployment Guide for TailorCV.ai

This guide covers multiple deployment options for your FastAPI resume optimizer application.

## Prerequisites

1. **Environment Variables**: You'll need to set up your OpenAI API key
2. **Git Repository**: Your code should be in a Git repository (GitHub, GitLab, etc.)
3. **Domain (Optional)**: For custom domain setup

---

## Option 1: Render (Recommended for Beginners) ⭐

**Render** is one of the easiest platforms for deploying FastAPI applications.

### Steps:

1. **Create a Render Account**
   - Go to [render.com](https://render.com)
   - Sign up with GitHub/GitLab

2. **Prepare Your Code**
   - Ensure your code is pushed to GitHub/GitLab
   - Update `main.py` to use environment variables for host/port:
   ```python
   if __name__ == "__main__":
       port = int(os.environ.get("PORT", 8000))
       uvicorn.run("main:app", host="0.0.0.0", port=port)
   ```

3. **Create a New Web Service**
   - Click "New +" → "Web Service"
   - Connect your repository
   - Configure:
     - **Name**: tailorcv (or your preferred name)
     - **Environment**: Python 3
     - **Build Command**: `pip install -r requirements.txt`
     - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
     - **Plan**: Free tier available

4. **Set Environment Variables**
   - Go to "Environment" tab
   - Add: `OPENAI_API_KEY` = your OpenAI API key
   - Add: `PORT` = 8000 (optional, Render sets this automatically)

5. **Deploy**
   - Click "Create Web Service"
   - Wait for deployment (5-10 minutes)
   - Your site will be live at: `https://tailorcv.onrender.com`

**Pros**: Free tier, easy setup, automatic HTTPS
**Cons**: Free tier spins down after inactivity (15 min cold start)

---

## Option 2: Railway 🚂

**Railway** offers great performance and easy deployment.

### Steps:

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **Deploy from GitHub**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

3. **Configure Environment**
   - Railway auto-detects Python
   - Add environment variable: `OPENAI_API_KEY`
   - Railway will auto-assign a domain

4. **Deploy**
   - Railway automatically builds and deploys
   - Your site will be live at: `https://your-app-name.up.railway.app`

**Pros**: Fast, good free tier, easy scaling
**Cons**: Free tier has usage limits

---

## Option 3: Google Cloud Run (Serverless) ☁️

**Cloud Run** is serverless and scales automatically.

### Steps:

1. **Install Google Cloud SDK**
   ```bash
   # Download from: https://cloud.google.com/sdk/docs/install
   ```

2. **Authenticate**
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

3. **Build and Deploy**
   ```bash
   # Build the container
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/tailorcv
   
   # Deploy to Cloud Run
   gcloud run deploy tailorcv \
     --image gcr.io/YOUR_PROJECT_ID/tailorcv \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars OPENAI_API_KEY=your_key_here
   ```

4. **Access Your App**
   - Cloud Run provides a URL automatically
   - Example: `https://tailorcv-xxxxx-uc.a.run.app`

**Pros**: Pay-per-use, auto-scaling, very reliable
**Cons**: Requires Google Cloud account setup

---

## Option 4: AWS (EC2 or Elastic Beanstalk) 🏗️

### Option 4A: AWS Elastic Beanstalk (Easier)

1. **Install EB CLI**
   ```bash
   pip install awsebcli
   ```

2. **Initialize EB**
   ```bash
   eb init -p python-3.11 tailorcv --region us-east-1
   eb create tailorcv-env
   ```

3. **Set Environment Variables**
   ```bash
   eb setenv OPENAI_API_KEY=your_key_here
   ```

4. **Deploy**
   ```bash
   eb deploy
   eb open
   ```

### Option 4B: AWS EC2 (More Control)

1. **Launch EC2 Instance**
   - Choose Ubuntu 22.04 LTS
   - t2.micro (free tier eligible)
   - Configure security group (open ports 80, 443, 8000)

2. **SSH into Instance**
   ```bash
   ssh -i your-key.pem ubuntu@your-ec2-ip
   ```

3. **Install Dependencies**
   ```bash
   sudo apt update
   sudo apt install python3-pip nginx
   pip3 install -r requirements.txt
   ```

4. **Set Up Nginx Reverse Proxy**
   ```bash
   sudo nano /etc/nginx/sites-available/tailorcv
   ```
   Add:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```
   ```bash
   sudo ln -s /etc/nginx/sites-available/tailorcv /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. **Run Your App**
   ```bash
   # Use systemd or screen/tmux
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

**Pros**: Full control, scalable
**Cons**: More setup, need to manage server

---

## Option 5: DigitalOcean App Platform 🌊

1. **Create Account** at [digitalocean.com](https://digitalocean.com)

2. **Create App**
   - Connect GitHub repository
   - Select Python
   - Auto-detects FastAPI

3. **Configure**
   - Build command: `pip install -r requirements.txt`
   - Run command: `uvicorn main:app --host 0.0.0.0 --port 8080`
   - Add environment variable: `OPENAI_API_KEY`

4. **Deploy**
   - DigitalOcean handles the rest
   - Get URL: `https://your-app-name.ondigitalocean.app`

**Pros**: Simple, good pricing
**Cons**: Paid service (no free tier)

---

## Option 6: Fly.io 🚀

1. **Install Fly CLI**
   ```bash
   # Windows: https://fly.io/docs/getting-started/installing-flyctl/
   ```

2. **Login**
   ```bash
   fly auth login
   ```

3. **Create Fly App**
   ```bash
   fly launch
   ```

4. **Set Secrets**
   ```bash
   fly secrets set OPENAI_API_KEY=your_key_here
   ```

5. **Deploy**
   ```bash
   fly deploy
   ```

**Pros**: Global edge deployment, good free tier
**Cons**: CLI-based setup

---

## Important: Pre-Deployment Checklist ✅

### 1. Update main.py for Production

Update the CORS and host settings:

```python
# In main.py, update CORS for production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-domain.com"],  # Change from "*"
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 2. Environment Variables

Create a `.env.example` file:
```
OPENAI_API_KEY=your_openai_api_key_here
PORT=8000
```

### 3. Update requirements.txt

Ensure all dependencies are listed:
```
fastapi
uvicorn[standard]
python-multipart
openai
markdown
weasyprint
pdfplumber
python-dotenv
jinja2
aiofiles
```

### 4. Security Considerations

- ✅ Never commit `.env` file
- ✅ Use environment variables for secrets
- ✅ Update CORS to specific domains
- ✅ Consider adding rate limiting
- ✅ Use HTTPS (most platforms provide this)

### 5. Static Files

Ensure `static/` and `templates/` directories are included in deployment.

### 6. File Size Limits

Update FastAPI to handle larger files:
```python
# In main.py
from fastapi import UploadFile, File
# Add file size limit
app = FastAPI(
    title="Resume Optimizer Backend",
    max_request_size=10 * 1024 * 1024  # 10MB limit
)
```

---

## Custom Domain Setup 🌐

### For Render/Railway/Cloud Run:

1. **Get Domain** (Namecheap, GoDaddy, etc.)
2. **Add DNS Records**:
   - CNAME: `www` → `your-app.onrender.com`
   - A Record: `@` → Render's IP (if provided)
3. **Configure in Platform**:
   - Add custom domain in platform settings
   - Enable SSL (automatic on most platforms)

---

## Monitoring & Maintenance 📊

### Recommended Additions:

1. **Health Check Endpoint**
   ```python
   @app.get("/health")
   async def health():
       return {"status": "healthy"}
   ```

2. **Error Logging**
   - Use Sentry or similar for error tracking
   - Add logging to track usage

3. **Analytics**
   - Google Analytics
   - Or platform-provided analytics

---

## Quick Start: Render (Recommended) 🎯

**Fastest way to go live:**

1. Push code to GitHub
2. Sign up at render.com
3. New Web Service → Connect repo
4. Set `OPENAI_API_KEY` environment variable
5. Deploy!

**Time to deploy: ~10 minutes**

---

## Need Help?

- **Render Docs**: https://render.com/docs
- **Railway Docs**: https://docs.railway.app
- **FastAPI Docs**: https://fastapi.tiangolo.com/deployment/

---

## Cost Comparison 💰

| Platform | Free Tier | Paid Starting |
|----------|-----------|---------------|
| Render | ✅ (with limits) | $7/month |
| Railway | ✅ ($5 credit) | Pay-as-you-go |
| Cloud Run | ✅ (generous) | Pay-per-use |
| Fly.io | ✅ (3 apps) | Pay-as-you-go |
| DigitalOcean | ❌ | $5/month |
| AWS | ✅ (EC2 free tier) | Pay-as-you-go |

---

**Recommended for your use case: Render or Railway** - easiest setup with good free tiers!
