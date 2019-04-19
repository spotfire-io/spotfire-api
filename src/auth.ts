import { ManagementClient } from "auth0";
import passport from "passport";
import { Strategy as CustomStrategy } from "passport-custom";
import { expressJwtSecret } from "jwks-rsa";
import jwt from "express-jwt";
import SpotifyWebApi from "spotify-web-api-node";
import _ from "lodash";

require("dotenv-flow").config();

const auth0 = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN || "",
  clientId: process.env.AUTH0_CLIENT_ID || "",
  clientSecret: process.env.AUTH0_CLIENT_SECRET || "",
  scope:
    process.env.AUTH0_MANAGEMENT_SCOPES || "read:users read:user_idp_tokens"
});

export const decodeJwt = (req, res, next) => {
  if (req.method == "POST") {
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
  } else {
    next();
  }
};

export const auth0StrategyName = "auth0-jwt";
export const auth0SpotifyStrategyName = "auth0-spotify";
const auth0SpotifyConnectionName = "Spotify";

export interface User {
  sub?: string;
  spotifyRefreshToken?: string;
  spotifyAccessToken?: string;
  spotifyAccessTokenExpiresAt?: number;
}

passport.use(
  auth0StrategyName,
  new CustomStrategy(
    async ({ user, method }: { user: User; method: string }, done) => {
      if (method == "POST") {
        // If we have a Spotify ID but no refresh token
        if (user && user.sub) {
          if (!user.spotifyRefreshToken) {
            try {
              const auth0User = await auth0.getUser({ id: user.sub! });
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
          if (user.spotifyRefreshToken) {
            const expiresOn = user.spotifyAccessTokenExpiresAt || 0;
            if (!user.spotifyAccessToken || expiresOn < new Date().getTime()) {
              console.log(`Fetching new access token for ${user.sub}`);
              const spotify = new SpotifyWebApi({
                clientId: process.env.SPOTIFY_CLIENT_ID,
                clientSecret: process.env.SPOTIFY_CLIENT_SECRET
              });
              spotify.setRefreshToken(user.spotifyRefreshToken);
              const { body: grant } = await spotify.refreshAccessToken();
              user.spotifyAccessToken = grant.access_token;
              user.spotifyAccessTokenExpiresAt =
                new Date().getTime() + grant.expires_in;
            }
          }
        }
      }
      done(null, user);
    }
  )
);

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});
