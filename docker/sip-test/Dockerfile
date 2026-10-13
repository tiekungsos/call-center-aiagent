FROM ubuntu:24.04
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends baresip-core \
 && rm -rf /var/lib/apt/lists/*
COPY ua.sh /ua.sh
ENTRYPOINT ["/ua.sh"]
