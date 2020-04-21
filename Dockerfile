FROM  mhart/alpine-node:12.1 as builder
COPY  package*.json /
RUN   set ex && npm install --production

FROM  mhart/alpine-node:slim-12.1

ARG   WORKDIR
ARG   PORT
ARG   FILES_LOCATION
ARG   INFLUX_URL
ARG   STORAGE

ENV   PORT $PORT
ENV   WORKDIR $WORKDIR
ENV   FILES_LOCATION $FILES_LOCATION
ENV   INFLUX_URL $INFLUX_URL
ENV   STORAGE $STORAGE

WORKDIR /$WORKDIR

RUN   apk add --no-cache tini

COPY  --from=builder /node_modules  ${WORKDIR}/node_modules
ADD   . ${WORKDIR}

EXPOSE $PORT

ENTRYPOINT ["/sbin/tini", "--", "/usr/bin/node", "index"]
CMD ["port=${PORT} filesLocation=${FILES_LOCATION} influxUrl=${INFLUX_URL} storage=${STORAGE}"]
