# Concurrency Fix TODO

## Plan Steps (Approved by User)

### 1. Update Dependencies [PENDING]
- Ensure openai library supports AsyncOpenAI
- Add tenacity for retries if needed

### 2. Refactor functions.py [✅ COMPLETE]
- Replace sync OpenAI with AsyncOpenAI
- Make get_resume_response async 
- Add exponential backoff retries
- Remove global httpx client

### 3. Refactor main.py [PENDING]
- Use tempfile.TemporaryDirectory() per request
- Unique file names with user_id + uuid
- Convert OpenAI calls to async (remove asyncio.to_thread)
- Use asyncio.wait_for for timeouts
- Semaphore ONLY around OpenAI call
- Enhanced error handling

### 4. Test Concurrency [PENDING]
- Local multi-user test
- Load test with 10+ concurrent requests

### 5. Deploy & Monitor [PENDING]
- Update deployment config
- Add logging/metrics

**Progress: 0/5 complete**

