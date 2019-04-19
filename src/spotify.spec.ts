// import { getPlaylist } from "./spotify";
// import SpotifyWebApi, { GetPlaylistTracksOptions } from "spotify-web-api-node";

// require("dotenv").config({
//   path: ".env.test"
// });

// beforeEach(() => {
//   jest.setTimeout(1000000);
// });

// test("basic", async () => {
//   const playlistId = "3qQ5qZnOyt7mfPX1rbXucV";

//   const spotify = new SpotifyWebApi({
//     clientId: process.env.SPOTIFY_CLIENT_ID,
//     clientSecret: process.env.SPOTIFY_CLIENT_SECRET
//   });
//   spotify.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN || "");
//   const refreshData = await spotify.refreshAccessToken();
//   spotify.setAccessToken(refreshData.body["access_token"]);
//   const playlist = await getPlaylist(spotify, playlistId);
//   expect(playlist).toBeDefined();
//   // expect("hello").toBe("hello");
// });
