# The API and the worker run from this image (Render: two services, different start commands).
FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY db ./db
RUN useradd --create-home siteline && chown -R siteline /app
USER siteline
EXPOSE 8000
# No --forwarded-allow-ips "*": that trusts an X-Forwarded-For the caller writes (deps.client_ip reads Render's entry).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
