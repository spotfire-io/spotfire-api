import { ApolloServer, gql } from "apollo-server";
import { importSchema } from "graphql-import";
import SpotifyWebApi from "spotify-web-api-node";
import { PlaylistPromise } from "./generated/prisma-client";

const resolvers = {
  Query: {
    playlist: async (_, { uri }: { uri: string }) => {
      const match = uri.match(
        /user[:\/]([^:\/]*)[:\/]playlist[:\/](\w*)(\?si=(\w+))?/
      );
      if (match) {
        const userId = match[1];
        const playlistId = match[2];
        const version = match[4];
      } else {
        return null;
      }
    }
  }
};

const server = new ApolloServer({
  typeDefs: [importSchema("./src/schema.graphql")],
  resolvers
});

server.listen().then(({ url }) => {
  console.log(`🚀  Server ready at ${url}`);
});
