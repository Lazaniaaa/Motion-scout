# Motion Scout

A community tool for the **Motion Mogathon**: Motion's official leaderboard, each creator's numbers from X and YouTube, and a deck builder for any star cap.

> Community tool for the Motion Mogathon by @NotYur. Not affiliated with Motion.

## What you get

- **How to play:** a 7-card walkthrough of cards, lineups, tournament week and scoring, from docs.motion.game.
- **Build a deck:** the best 5 different creators for any star cap from 8 to 40, valued by Motion's official rank × your card boosts. Add the cards you own, with their rarity and stars, under *My cards*.
- **My lineup this week:** track the five you submitted, from Monday's lineup lock to Friday's results.
- **Leaderboard and Movers:** Motion's official creator ranks with a trend line for each creator, the biggest climbers and fallers since Monday's lock, and social stats from X where available.
- **Memes:** a wall of Motion memes from the community. Post your meme on X, paste the link, and it shows up after a quick review. Like your favorites (tap again to take a like back). Every Sunday at 17:00 UTC the most-liked meme of the week is crowned Meme of the week. Open a meme to see the full post through X's official embed.
- **What's next:** the roadmap.

Stars are ≈ estimated from rank (Fantasy Top's published tier split) until real stars from the game are added.

## How the data works

The order comes from Motion's public leaderboard. A Google Apps Script saves every snapshot of it (about every 4 hours) for rank history, and collects creator stats daily into a Google Sheet. Stats are context for your picks and don't change the order.

## Run it

Static files only. Open `index.html`, or serve the folder (`python -m http.server`). GitHub Pages: *Settings → Pages → Deploy from branch → main / root*.

## Disclaimer

An unofficial planning tool. It isn't Motion's score, and it isn't financial advice.
