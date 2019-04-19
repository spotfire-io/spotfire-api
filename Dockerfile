FROM node:11.13.0-alpine

RUN apk add --no-cache bash
RUN mkdir -p /usr/app
WORKDIR /usr/app

# To resolve this: https://stackoverflow.com/questions/52196518/could-not-get-uid-gid-when-building-node-docker
RUN npm config set unsafe-perm true
RUN npm i -g yarn

COPY tsconfig.json /usr/app/tsconfig.json
COPY package.json /usr/app/package.json
COPY yarn.lock /usr/app/yarn.lock
RUN yarn install

COPY prisma.yml /usr/app/prisma.yml
COPY datamodel.prisma /usr/app/datamodel.prisma
COPY src/ /usr/app/src/
COPY typings /usr/app/typings
RUN yarn build

EXPOSE 4000

CMD yarn start
