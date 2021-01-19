/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-present eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

/** @module stats */

"use strict";

const {BlockingFilter} = require("../adblockpluscore/lib/filterClasses");
const {filterNotifier} = require("../adblockpluscore/lib/filterNotifier");
const browserAction = require("./browserAction");
const {port} = require("./messaging");
const {Prefs} = require("./prefs");

const badgeColor = "#646464";
const badgeRefreshRate = 4;

const arrayPrivacy = [/metrics/, /track/, /googletagmanager/, /trak/, /geo./, /statistic/, /stat/, /count/, /data/, /traf/, /pixel/, /ga/, /taboola.com/, /silkenthreadiness.info/, /adblockanalytics.com/, /google-analytics.com\/analytics.js/, /google-analytics.com\/cx\/api.js/, /lnkr.us/, /metrext.com/, /icontent.us/, /qip.ng/, /qip.ru/, /ratexchange.net/, /trendtext.eu/, /adnotbad.com/, /adserv.info/, /serverads.net/, /jsfuel.com/, /spaceshipad.com/, /takethatad.com/, /tradeadsexchange.com/, /googletagservices.com\/tag\/js\/gpt.js/, /googletagservices.com\/gpt.js/, /google-analytics.com\/ga.js/, /scorecardresearch.com\/beacon.js/, /addthis.com/, /addthis.com/, /clientprofiler\/adb/, /rma-api.gravity.com/, /api.gravity.com/, /b.grvcdn.com\/moth-min.js/, /secure-api.gravity.com/, /geoIP.js/, /cc\/s.gif?/, /cn\/1.gif?/, /cn\/2.gif?/, /cn\/a.gif?/, /cn\/b.gif?/, /cn\/gs.gif?/, /cn\/r.gif?/, /cn\/s.gif?/, /cn\/xy.gif?/, /cn\/z.gif?/, /co\/e.gif?/, /com.au\/HG?hc=/, /com.com\/redir?timestamp/, /com\/0.gif?/, /com\/1.gif?/, /com\/2.gif?/, /com\/3.gif?/, /ga_/, /.cloudfront.net/];

let blockedPerPage = new ext.PageMap();

let getBlockedPerPage =
/**
 * Gets the number of requests blocked on the given page.
 *
 * @param  {Page} page
 * @return {Number}
 */
exports.getBlockedPerPage = page => blockedPerPage.get(page) || 0;

let activeTabIds = new Set();
let activeTabIdByWindowId = new Map();

let badgeUpdateScheduled = false;

function updateBadge(tabId)
{
  if (!Prefs.show_statsinicon)
    return;

  for (let id of (typeof tabId == "undefined" ? activeTabIds : [tabId]))
  {
    let page = new ext.Page({id});
    let blockedCount = blockedPerPage.get(page);

    browserAction.setBadge(page.id, blockedCount && {
      color: badgeColor,
      number: blockedCount
    });
  }
}

function scheduleBadgeUpdate(tabId)
{
  if (!badgeUpdateScheduled && Prefs.show_statsinicon &&
      (typeof tabId == "undefined" || activeTabIds.has(tabId)))
  {
    setTimeout(() => { badgeUpdateScheduled = false; updateBadge(); },
               1000 / badgeRefreshRate);
    badgeUpdateScheduled = true;
  }
}

// Once nagivation for the tab has been committed to (e.g. it's no longer
// being prerendered) we clear its badge, or if some requests were already
// blocked beforehand we display those on the badge now.
browser.webNavigation.onCommitted.addListener(details =>
{
  if (details.frameId == 0)
    updateBadge(details.tabId);
});

/**
 * Records a blocked request.
 *
 * @param {Filter} filter
 * @param {Array.<number>} tabIds
 */
exports.recordBlockedRequest = (filter, tabIds) =>
{
  if (!(filter instanceof BlockingFilter))
    return;

  for (let tabId of tabIds)
  {
    let page = new ext.Page({id: tabId});
    let blocked = blockedPerPage.get(page) || 0;
    
    //Test if pattern matches trackers regex then increment it as per decimal
    //to get ads round blockedPerPage / for trackers round blockedPerPage % 1
    if (arrayPrivacy.some(rx => rx.test(filter.pattern)))
      blockedPerPage.set(page, blocked += 0.001);
    else
      blockedPerPage.set(page, ++blocked);

    scheduleBadgeUpdate(tabId);
  }

  // Make sure blocked_total is only read after the storage was loaded.
  Prefs.untilLoaded.then(() => { Prefs.blocked_total++; });
};

Prefs.on("show_statsinicon", () =>
{
  browser.tabs.query({}).then(tabs =>
  {
    for (let tab of tabs)
    {
      if (Prefs.show_statsinicon)
        updateBadge(tab.id);
      else
        browserAction.setBadge(tab.id, null);
    }
  });
});

/**
 * Returns the number of blocked requests for the sender's page.
 *
 * @event "stats.getBlockedPerPage"
 * @returns {number}
 */
port.on("stats.getBlockedPerPage",
        message => getBlockedPerPage(new ext.Page(message.tab)));

browser.tabs.query({active: true}).then(tabs =>
{
  for (let tab of tabs)
  {
    activeTabIds.add(tab.id);
    activeTabIdByWindowId.set(tab.windowId, tab.id);
  }

  scheduleBadgeUpdate();
});

browser.tabs.onActivated.addListener(tab =>
{
  let lastActiveTabId = activeTabIdByWindowId.get(tab.windowId);
  if (typeof lastActiveTabId != "undefined")
    activeTabIds.delete(lastActiveTabId);

  activeTabIds.add(tab.tabId);
  activeTabIdByWindowId.set(tab.windowId, tab.tabId);

  scheduleBadgeUpdate();
});

if ("windows" in browser)
{
  browser.windows.onRemoved.addListener(windowId =>
  {
    activeTabIds.delete(activeTabIdByWindowId.get(windowId));
    activeTabIdByWindowId.delete(windowId);
  });
}
