# Chronicle manual

Chronicle is your own history timeline. It starts empty: you fill it in as you read and study, and it helps you connect what you learn and find it again. Everything stays on your device.

## Getting started

- **Add** (top bar) creates an event, a period (or war, or movement) or a person. You can also double-click the timeline to add something at that date.
- **Timeline**, **Map** and **Both** switch the view. On a phone you see one at a time.
- **Library** lists your notes, sources, trends and territories. **Help** opens this manual.
- The top bar says **Saved on this device** once your changes are stored. There is no account and no cloud copy, so export a backup now and then (see [Backups and working offline](#backups-and-working-offline)).

> Install Chronicle like an app: in Chrome or Edge use **Install** in the address bar; on iPhone use **Share → Add to Home Screen**; on Android use **Add to home screen**. It then opens in its own window and works offline.

## Entries: events, periods and people

- An **event** is a moment (a battle, a treaty). A **period** has a start and an end (a war, a reign). A **person** runs from birth to death.
- Type dates the way you would say them: `431 BCE`, `c. 1440`, `1914-07-28`. The field shows how it read your date. Leave the end empty if it's unknown or ongoing.
- Approximate dates (`c.`) show with a dashed edge on the timeline.
- Zoomed far out, a short life or period is drawn too thin to hold its name, so the name runs on past it and entries spread onto more lines so names don't overlap. Zoom in and names go back inside their bars.
- Each entry has a **category** (politics, war, ideas, science, technology, society, arts). The colored chips under the top bar show or hide a category everywhere, on the timeline and on the map.
- Click an entry to open it, then **Edit** to change it or **Show on map** to jump to its year on the map.

## Adding from Wikipedia

**Add → From Wikipedia…** searches Wikipedia. Pick a page and you get a new entry filled in: kind and dates from Wikidata, places for the map, a picture with its credit, the intro as a quotation, and the page as a source. Nothing is saved until you check it and press **Add to timeline**. If you already have that entry, Chronicle tells you.

This needs a connection.

## Notes, sources and citations

- **Write a note** on any entry, territory or trend. A note can be linked to several things at once, so one note can tie Pericles, the Delian League and Athens together.
- **Sources** are your bibliography: books, articles, web pages. Add them from **Library → Sources → New source**.
- **Add and cite** in an entry or note links a source, with the pages or location you read.

## Connections

In an entry's editor, connect it to another entry and choose the kind: *influenced*, *caused*, *part of*, *responded to* or *related*. Connections show on both entries. On the map, **Layers → Show connections** draws a dashed line between connected entries when both are on the map.

> Use *part of* for battles in a war, so later you can see a war and its battles together.

### Influences

Click a person on the timeline and the people connected to them by *influenced* light up: amber for who influenced them, blue for whom they influenced, with arrows showing which way it went. Everything else fades back. Click empty space or close the panel to clear it. Arrows only show while both people are in view.

For a person added from Wikipedia, **Suggest influences** lists who Wikipedia says influenced them and whom they influenced. People already on your timeline get **Connect**; the rest get **Add from Wikipedia**. When you add a person from Wikipedia, their influences who are already on your timeline are filled in as connections, so you can remove any you disagree with before saving. Suggestions need a connection.

## Pictures

**Add a picture** on an entry. Search Wikimedia Commons (credit and license come with it), paste an **Image link**, or **Upload** your own. Pictures you have looked at stay available offline.

## Trends over time

A trend is a number that changes over the years (population, the price of wheat), drawn as a strip under the timeline.

- **Add → Trend over time**, then paste one “year, value” per line, or paste an Our World in Data chart link to bring its data in.
- Choose **Linear** or **Log** scale. Log suits numbers that grow by multiples.
- An Our World in Data trend can bring **every country**. You can then color the map by it (see [The map](#the-map)).

## The map

- The map and the timeline share one **year**. Type a year in the year box (like `490 BCE`), drag the slider, or press **Play** to move through time. Choose the speed next to it.
- Entries with places show as **pins** while the year is within their dates. Events stay for a few decades afterwards so you can see them. **Layers → Keep past entries on the map** leaves them all, to watch something spread.
- **Layers → Show reference borders** draws faint outlines of every polity from the nearest historical world map. They're for orientation only, aren't saved, and need a connection the first time.
- **Layers → Color the map by** shades countries by a trend for the current year, on today's borders, with a legend.
- The map remembers where you left it on this device.

## Territories

A territory is a polity's borders over time: a city-state, a kingdom, an empire. Each set of borders has dates, and the map shows whichever set is in force for the year.

**Add a territory** on the map (or **Add → Territory on the map…**) offers three ways:

### Draw your own

For city-states and anything the historical maps don't have. Works offline.

1. Press **Draw on the map**. Zoom in first if you like; the map's own buttons and scrolling still work.
2. Click around the border, point by point.
3. Click the first point again to close the outline, or press **Done**.
4. For a separate piece, like an island, press **Add another part** and outline it too.
5. **Undo point** removes the last point; **Cancel** or **Esc** stops without saving.
6. Give it a name, a category, and **From** and **Until** dates. Leave **Until** empty if the borders last until your next set (or for good).

### From a GeoJSON file

If you have borders from geojson.io, QGIS or a dataset, choose the file under **Or bring borders from a GeoJSON file**. If the file holds several areas, pick one. Its name fills in if the file has one. Fine detail is kept, so small city-states and islands survive.

### From historical maps

Pick a **Map year**, press **Show its polities**, choose one, and Chronicle looks for it across a range of world maps. Each map's borders last until the next map's year. These maps are approximate and coarse for the ancient world (for Classical Greece there are only maps for 500, 400 and 323 BCE), and they need a connection.

### Borders that change over time

Open a territory and press **Edit**. Under **Borders over time**, every set of borders has its own **From** and **Until** dates, which you can change. **Draw borders** or a GeoJSON file adds another set, for example Athens after 338 BCE. **Remove** deletes a set. Press **Save changes** when you're done.

## Backups and working offline

- **More → Export a backup** downloads your whole timeline as one file. Keep it somewhere safe; it's also how you move your timeline to another device.
- **More → Import a file…** opens a backup. If you already have a timeline, choose **Merge into my timeline** (keeps both; where the same thing changed in both, the newer change wins) or **Replace my timeline**.
- Everything except searching Wikipedia, Commons and Our World in Data, and loading historical maps, works offline. Those say so when you're offline.
- Older backups always open in newer versions of Chronicle.

## Versions

There are two copies of Chronicle:

- **Your app**, at the web address you installed it from (GitHub Pages). This is the stable version you use day to day, and your timeline lives there.
- **The version in progress**, which runs on your computer while Claude Code works on the next change. It keeps its own separate test data, so nothing there touches your timeline.

When a change is finished and tested, it is released to your app. The next time you open it, a banner says **A new version of Chronicle is ready**. It never reloads by itself, so finish what you're doing and press **Reload**; your work is saved first.

Your data carries into new versions:

- When a new version changes how data is stored, your timeline is upgraded automatically when you open it, and an untouched copy of the old data is kept on your device.
- If an old tab or old copy of the app opens data saved by a newer version, it shows **Read-only** and won't change anything. Reload to update it.

The version you're using is shown at the bottom of this manual.

> Moving your timeline into the app for the first time: in the copy that has it, use **More → Export a backup**, then in your app use **More → Import a file…**.
