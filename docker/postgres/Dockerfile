FROM pgvector/pgvector:pg18

# Install pg_cron
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-cron \
    && rm -rf /var/lib/apt/lists/*

# Configure pg_cron to load at server startup
RUN echo "shared_preload_libraries = 'pg_cron'" >> /usr/share/postgresql/postgresql.conf.sample \
    && echo "cron.database_name = 'murder'" >> /usr/share/postgresql/postgresql.conf.sample
