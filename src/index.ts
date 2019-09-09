import * as path from "path";
import { ApolloServer, defaultPlaygroundOptions } from "apollo-server-express";
import { ApolloErrorConverter } from "apollo-error-converter";
import expressPlayground from "graphql-playground-middleware-express";
import { RenderPageOptions } from "graphql-playground-html";
import { makePrismaSchema } from "nexus-prisma";
import express from "express";
import passport from "passport";
import SpotifyWebApi from "spotify-web-api-node";

import { Prisma } from "./generated/prisma-client";
import datamodelInfo from "./generated/nexus-prisma";

import { Context, getPipelines, limiters } from "./utils";
import { decodeJwt, passportHandlers, User } from "./auth";

import * as schemaTypes from "./schema";

require("dotenv-flow").config();

import logger from "./logger";

const PORT = process.env.PORT || 4001;

const prisma = new Prisma({
  endpoint: process.env["PRISMA_ENDPOINT"] || "http://localhost:4466",
  secret: process.env["PRISMA_MANAGEMENT_API_SECRET"] || ""
  // debug: true
});

const schema = makePrismaSchema({
  types: Object.values(schemaTypes),

  prisma: {
    datamodelInfo,
    client: prisma
  },

  outputs: {
    schema: path.join(__dirname, "./generated/schema.graphql"),
    typegen: path.join(__dirname, "./generated/nexus.ts")
  }
});

const app = express();

const server = new ApolloServer({
  schema,
  tracing: true,
  debug: true,
  playground: false,
  formatError: error => {
    logger.error(error);
    return { message: error.message };
  },
  context: ({ req }): Context => {
    const user: User = req.user;
    const context: Context = { prisma, limiters };
    if (user && user.spotifyAccessToken) {
      context.spotify = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      });
      context.spotify.setAccessToken(user.spotifyAccessToken);
    }
    context.pipelines = getPipelines(prisma, context.spotify);
    return context;
  }
});

app.use(
  passport.initialize(),
  passport.session(),
  decodeJwt,
  ...passportHandlers
);

// Enable GraphQL playground separately so we can receive headers from URL params
app.get("/", (req, res, next) => {
  const headers = req.query["headers"] || {};
  const options: RenderPageOptions = {
    ...defaultPlaygroundOptions,
    version: "1.7.20",
    endpoint: `/?headers=${encodeURIComponent(headers)}`,
    settings: {
      ...defaultPlaygroundOptions.settings,
      "editor.cursorShape": "line"
    }
  };
  expressPlayground(options)(req, res, next);
});

server.applyMiddleware({ app, path: "/" });

app.listen({ port: PORT }, () => {
  const path = `http://localhost:${PORT}${server.graphqlPath}`;
  logger.info(`🚀 Server ready at ${path}`, {
    path,
    port: PORT,
    graphql_path: server.graphqlPath
  });
});
