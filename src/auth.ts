import { ManagementClient } from "auth0";
import passport from "passport";
import { Strategy as CustomStrategy } from "passport-custom";
import { expressJwtSecret } from "jwks-rsa";
import jwt from "express-jwt";
import { Request, RequestHandler } from "express";
import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";
import bodyParser = require("body-parser");

require("dotenv-flow").config();

const spotifyRefreshTokenHeaderName = (
  process.env["SPOTIFY_REFRESH_TOKEN_HEADER_NAME"] || "x-spotify-refresh-token"
).toLowerCase();
const auth0SpotifyConnectionName =
  process.env["AUTH0_SPOTIFY_CONNECTION_NAME"] || "Spotify";

export interface User {
  sub?: string;
  spotifyUserId?: string;
  spotifyRefreshToken?: string;
  spotifyAccessToken?: string;
  spotifyAccessTokenExpiresAt?: number;
}

const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN || "",
  clientId: process.env.AUTH0_CLIENT_ID || "",
  clientSecret: process.env.AUTH0_CLIENT_SECRET || "",
  scope:
    process.env.AUTH0_MANAGEMENT_SCOPES || "read:users read:user_idp_tokens"
});

export const decodeJwt = (req, res, next) => {
  // Allow anonymous access to support GraphQL Introspection
  if (!req.headers.authorization) {
    next();
  } else {
    jwt({
      secret: expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`
      }),
      //   issuer: `https://${process.env.AUTH0_DOMAIN}`,
      algorithms: ["RS256"]
    })(req, res, next);
  }
};

export const strategies = {
  setEmptyUserIfNoneDefined: new CustomStrategy(
    async ({ user }: Request, done) => {
      done(null, user || {});
    }
  ),
  getSpotifyRefreshTokenFromHeader: new CustomStrategy(
    async ({ user, headers }: Request, done) => {
      const tokenFromHeader = headers[spotifyRefreshTokenHeaderName];
      if (tokenFromHeader) {
        user.spotifyRefreshToken = tokenFromHeader;
      }
      done(null, user);
    }
  ),
  getSpotifyRefreshTokenFromAuth0: new CustomStrategy(
    async (req: Request, done) => {
      const { user } = req;
      if (!user.spotifyRefreshToken && user.sub) {
        try {
          console.log(`Getting user detail from auth0 for user '${user.sub}`);
          const auth0User = await auth0.getUser({ id: user.sub });
          if (auth0User.identities) {
            const identity = _.chain(auth0User)
              .get("identities")
              .filter(i =>
                i ? i.connection === auth0SpotifyConnectionName : false
              )
              .first()
              .value();

            if (identity) {
              user.spotifyRefreshToken = identity["refresh_token"];
            }
          }
        } catch (err) {
          console.error(
            `An error occurred fetching the Auth0 user for ${user.sub}`,
            err
          );
          done(err, false);
        }
      }
      done(null, user);
    }
  ),
  getSpotifyAccessTokenFromRefreshToken: new CustomStrategy(
    async (req: Request, done) => {
      const { user } = req;
      if (user.spotifyRefreshToken) {
        const expiresOn = user.spotifyAccessTokenExpiresAt || 0;
        if (!user.spotifyAccessToken || expiresOn < new Date().getTime()) {
          console.log(`Fetching new access token`);
          const spotify = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET
          });
          spotify.setRefreshToken(user.spotifyRefreshToken);
          try {
            const { body: grant } = await spotify.refreshAccessToken();
            user.spotifyAccessToken = grant.access_token;
            user.spotifyAccessTokenExpiresAt =
              new Date().getTime() + grant.expires_in;
          } catch (err) {
            console.error(
              `An error occurred fetching an access token from Spotify for ${
                user.spotifyRefreshToken
              }`,
              err
            );
            done(err, false);
          }
        }
      }
      done(null, user);
    }
  )
};

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

export const passportHandlers: RequestHandler[] = [];

Object.keys(strategies).forEach(name => {
  passport.use(name, strategies[name]);
  passportHandlers.push(passport.authenticate(name));
});
