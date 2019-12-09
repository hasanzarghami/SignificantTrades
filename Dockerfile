FROM node:10

ARG WORKDIR
ARG PORT
ARG DATA_FOLDER

ENV PORT $PORT
ENV WORKDIR $WORKDIR
ENV DATA_FOLDER $DATA_FOLDER

WORKDIR /$WORKDIR

COPY package*.json ./
RUN npm install --production && \
    npm cache clean --force

COPY . ./

EXPOSE $PORT
CMD ["sh", "-c", "npm start port=${PORT} dataFolder=${DATA_FOLDER}"]
