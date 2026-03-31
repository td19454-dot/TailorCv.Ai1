FROM python:3.11
WORKDIR /app

# Install the application dependencies
COPY requirements.txt ./


# Copy in the source code
COPY  . /app


# Setup an app user so the container doesn't run as the root user
RUN pip install -r requirements.txt

EXPOSE 8000


CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]