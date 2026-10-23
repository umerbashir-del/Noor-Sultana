# Build from the Noor Sultana folder so the prototype and knowledge pages are
# available at the same relative paths used by the local app.
FROM node:22.23.4-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY prototype/requirements-voice.txt prototype/requirements-voice-nodeps.txt /tmp/
RUN python3 -m venv /opt/noor-venv \
    && /opt/noor-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/noor-venv/bin/pip install --no-cache-dir -r /tmp/requirements-voice.txt \
    && /opt/noor-venv/bin/pip install --no-cache-dir --no-deps -r /tmp/requirements-voice-nodeps.txt

WORKDIR /app
COPY prototype /app/prototype
COPY lib/speech-cache.mjs lib/speech-segments.mjs /app/lib/
COPY Documents/knowledge /app/Documents/knowledge
RUN mkdir -p /app/data && chown -R node:node /app/data /app/prototype /app/Documents

ENV NODE_ENV=production \
    NOOR_HOST=0.0.0.0 \
    PORT=4173 \
    NOOR_DATA_DIR=/app/data \
    CHATTERBOX_PYTHON=/opt/noor-venv/bin/python \
    ASR_PYTHON=/opt/noor-venv/bin/python \
    HF_HOME=/app/data/huggingface \
    PYTHONUNBUFFERED=1
USER node
EXPOSE 4173
VOLUME ["/app/data"]
CMD ["node", "/app/prototype/server.mjs"]
