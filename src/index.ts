import * as path from "path";
import { ApolloServer, defaultPlaygroundOptions } from "apollo-server-express";
import expressPlayground from "graphql-playground-middleware-express";
import { makePrismaSchema } from "nexus-prisma";
import express from "express";
import passport from "passport";
import SpotifyWebApi from "spotify-web-api-node";

import { Prisma } from "./generated/prisma-client";
import datamodelInfo from "./generated/nexus-prisma";

import { Context, getPipelines, limiters } from "./utils";
import { decodeJwt, passportHandlers, User } from "./auth";

import { Query, Mutation, Playlist } from "./schema";

require("dotenv-flow").config();

const PORT = process.env.PORT || 4001;

const prisma = new Prisma({
  endpoint: process.env["PRISMA_ENDPOINT"] || "http://localhost:4466",
  secret: process.env["PRISMA_MANAGEMENT_API_SECRET"] || ""
  // debug: true
});

const schema = makePrismaSchema({
  types: [Query, Mutation, Playlist],

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
  expressPlayground({
    ...defaultPlaygroundOptions,
    endpoint: `/?headers=${encodeURIComponent(headers)}`,
    settings: {
      ...defaultPlaygroundOptions.settings,
      "editor.cursorShape": "line"
    }
  })(req, res, next);
});

server.applyMiddleware({ app, path: "/" });

app.listen({ port: PORT }, () =>
  console.log(
    `🚀 Server ready at http://localhost:${PORT}${server.graphqlPath}`
  )
);
