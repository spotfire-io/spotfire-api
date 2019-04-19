import * as path from "path";
import { ApolloServer } from "apollo-server-express";
import { makePrismaSchema, prismaObjectType } from "nexus-prisma";
import { stringArg } from "nexus/dist";
import express from "express";
import passport from "passport";
import SpotifyWebApi from "spotify-web-api-node";

import { Prisma } from "./generated/prisma-client";
import datamodelInfo from "./generated/nexus-prisma";

import { Context } from "./utils";
import { decodeJwt, auth0StrategyName, User } from "./auth";

import { Query } from "./schema";

require("dotenv-flow").config();

const PORT = process.env.PORT || 4002;

const prisma = new Prisma({
  endpoint: process.env["PRISMA_ENDPOINT"] || "http://localhost:4466",
  secret: process.env["PRISMA_SECRET"] || ""
});

const schema = makePrismaSchema({
  types: [Query],

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
  context: ({ req }): Context => {
    const user: User = req.user;
    const context = { prisma };
    if (user && user.spotifyAccessToken) {
      const spotify = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET
      });
      spotify.setAccessToken(user.spotifyAccessToken);
      return {
        spotify,
        prisma
      };
    } else {
      throw Error("Could not find spotify access token in request user");
    }
  }
});

app.use(
  server.graphqlPath,
  passport.initialize(),
  passport.session(),
  decodeJwt,
  passport.authenticate(auth0StrategyName)
);
server.applyMiddleware({ app });

app.listen({ port: PORT }, () =>
  console.log(
    `🚀 Server ready at http://localhost:${PORT}${server.graphqlPath}`
  )
);
