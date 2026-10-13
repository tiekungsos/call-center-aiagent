FROM ubuntu:24.04
# asterisk 20.6 จาก Ubuntu มี app/res_audiosocket, func_curl, codec_opus_open_source ครบ ไม่ต้อง build จาก source
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends asterisk asterisk-modules gettext-base \
 && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /entrypoint.sh
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD test "$(asterisk -rx 'module show like audiosocket' | grep -cE '^(app|res)_audiosocket\.so .*Running')" -eq 2
ENTRYPOINT ["/entrypoint.sh"]
