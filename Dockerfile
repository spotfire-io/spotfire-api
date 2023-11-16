FROM node:16

# Specify the PATH for node_modules to get picked up correctly
ENV PATH /usr/app:/usr/app/node_modules/.bin:$PATH
ENV NODE_PATH=/usr/app:/usr/app/node_modules
ENV PORT 4001

WORKDIR /usr/app

COPY \
    package.json \
    yarn.lock \
    /usr/app/

RUN yarn install

COPY prisma.yml \
    datamodel.prisma \
    tsconfig.json \
    /usr/app/

COPY src /usr/app/src
COPY typings /usr/app/typings

RUN yarn build

EXPOSE ${PORT}

CMD node /usr/app/dist/index.js

# ENTRYPOINT ["node", "/usr/app/dist/index.js"]