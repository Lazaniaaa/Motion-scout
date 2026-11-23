# Motion Scout

A community tool for the **Motion Mogathon**: Motion's official leaderboard, each creator's numbers from X and YouTube, and a deck builder for any star cap.

> Community tool for the Motion Mogathon by @NotYur. Not affiliated with Motion.

## What you get

- **How to play:** a 7-card walkthrough of cards, lineups, tournament week and scoring, from docs.motion.game.
- **Build a deck:** the best 5 different creators for any star cap from 8 to 40, valued by Motion's official rank × your card boosts. Add the cards you own, with their rarity and stars, under *My cards*.
- **My lineup this week:** track the five you submitted, from Monday's lineup lock to Friday's results.
- **Leaderboard and Movers:** Motion's official creator ranks with a trend line for each creator, the biggest climbers and fallers since Monday's lock, and social stats from X where available. Hover a chart (or tap it on a phone) to see the rank or the views at each point.
- **Creator pages:** click any creator for their rank history, 7-day rank range (steady or swingy compared with everyone else), X stats, and their posting rhythm: average posts a day and a week, Mon–Fri vs weekends, the busiest weekdays and their best day. Each page has its own link (`#c/<handle>`).
- **Insights:** *Week in Motion*, a recap of each tournament week (who held #1, the biggest climbs and falls, who held their place, the most views and posts on X, the biggest single day, the meme of the week); *Who posts the most*, a sortable table of posts a day, average reach (views per post) and views a day on X next to each creator's rank now and their 7-day average rank; *Rank vs activity*, each creator's place by posts, views and interactions a day against their place on the board, with the gap in places (who ranks higher or lower than their X activity suggests); *Steady or swingy*, how much each creator's rank moves; and *Does X move the rank?*, a chart of each creator's X activity against their rank change, with a plain-words verdict.
- **Content map:** every creator by format (streams, videos, podcasts & shows, threads & essays, takes, memes, news) and topic, with a rough mix in percent for creators who make more than one kind of content. Click a format or topic to highlight everyone who makes it, and see which formats and topics rank best. Tagged by hand (`data` isn't public; the result is `js/content-map.js`), so read it as a guide. The mix also shows on each creator's page and as a chip on the leaderboard.
- **Memes:** a wall of Motion memes from the community. Post your meme on X, paste the link, and it shows up after a quick review. Like your favorites (tap again to take a like back). Every Sunday at 17:00 UTC the most-liked meme of the week is crowned Meme of the week. Open a meme to see the full post through X's official embed. No meme yet? The **meme maker** has 49 popular templates (from imgflip) or takes your own picture: add text, drag it into place, then download it or post it on X with a ready-made, editable caption. Everything is drawn in your browser.
- **What's next:** the roadmap.

Stars are ≈ estimated from rank (Fantasy Top's published tier split) until real stars from the game are added.

## How the data works

The order comes from Motion's public leaderboard. A Google Apps Script saves every snapshot of it (about every 4 hours) for rank history, and collects creator stats daily into a Google Sheet. Stats are context for your picks and don't change the order.

## Run it

Static files only. Open `index.html`, or serve the folder (`python -m http.server`). GitHub Pages: *Settings → Pages → Deploy from branch → main / root*.

## Disclaimer

An unofficial planning tool. It isn't Motion's score, and it isn't financial advice.
