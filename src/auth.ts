import { ManagementClient } from "auth0";
import passport from "passport";
import { Strategy as CustomStrategy } from "passport-custom";
import { expressJwtSecret } from "jwks-rsa";
import jwt from "express-jwt";
import { Request, RequestHandler } from "express";
import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";
import bodyParser = require("body-parser");
import NodeCache from "node-cache"

import logger from "./logger"

require("dotenv-flow").config();

const spotifyRefreshTokenHeaderName = (
  process.env["SPOTIFY_REFRESH_TOKEN_HEADER_NAME"] || "x-spotify-refresh-token"
).toLowerCase();
const auth0SpotifyConnectionName =
  process.env["AUTH0_SPOTIFY_CONNECTION_NAME"] || "Spotify";

const ACCESS_TOKEN_SLACK_SECONDS = 60

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

const caches = {
  spotify: {
    refreshToken: new NodeCache(),
    accessToken: new NodeCache()
  }
}

interface OAuthAccessToken {
  token: String
  expiresAt: number
}

const fetchSpotifyAccessToken = async (refreshToken: string, userId: string, useCache: boolean = true) => {
  const now = new Date().getTime()
  if(useCache) {
    const cached = caches.spotify.accessToken.get<OAuthAccessToken>(refreshToken) 
    if(cached) {
      logger.debug('Using cached Spotify access token', {user_id: userId, expires_at: cached.expiresAt})
      return cached;
    }
  }
  logger.info('Fetching new access token', {user_id: userId});
  const spotify = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET
  });
  spotify.setRefreshToken(refreshToken);
  const { body: grant } = await spotify.refreshAccessToken();
  const expiresInSeconds = grant.expires_in
  const accessToken = {token: grant.access_token, expiresAt: now + expiresInSeconds * 1000}
  if(useCache) {
    const ttl = expiresInSeconds - ACCESS_TOKEN_SLACK_SECONDS
    logger.debug('Caching Spotify access token', {user_id: userId, ttl})
    caches.spotify.accessToken.set<OAuthAccessToken>(refreshToken, accessToken, ttl)
  }
  return accessToken
}

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
        const userId = user.sub;
        const cached = caches.spotify.refreshToken.get(userId)
        if(cached) {
          user.spotifyRefreshToken = cached
        } else {
          try {
            logger.info('Getting user detail from auth0', {user_id: userId});
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
                caches.spotify.refreshToken.set(user.sub, user.spotifyRefreshToken)
              } else {
                logger.warn('No Spotify identity found for Auth0 user', {user_id: userId})
              }
            }
          } catch (error) {
            logger.error('Error occurred fetching the Auth0 user details', {user_id: userId, error});
            done(error, false);
          }
        }
      }
      done(null, user);
    }
  ),
  getSpotifyAccessTokenFromRefreshToken: new CustomStrategy(
    async (req: Request, done) => {
      const { user } = req;
      const userId = user.sub;
      if (user.spotifyRefreshToken) {
        try {
          const now = new Date().getTime()
          const accessToken: OAuthAccessToken | undefined = 
            (user.spotifyAccessToken && user.spotifyAccessTokenExpiresAt < now - ACCESS_TOKEN_SLACK_SECONDS * 1000) ?
              {token: user.spotifyAccessToken, expiresAt: user.spotifyAccessTokenExpiresAt}
              : await fetchSpotifyAccessToken(user.spotifyRefreshToken, user.sub, true)

              if(accessToken) {
                user.spotifyAccessToken = accessToken.token
                user.spotifyAccessTokenExpiresAt = accessToken.expiresAt
              }
        } catch(error) {
          console.error(`An error occurred fetching Spotify access token`, {userId, error});
          done(error, false);
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
