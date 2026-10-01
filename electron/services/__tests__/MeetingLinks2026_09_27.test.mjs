// Which meeting a link joins (meetingDetection/meetingLinks.ts). A calendar
// event and the browser tab the user is in are the same meeting exactly when
// their keys are equal, so these pin real link shapes from each provider, and
// that no key ever carries a password.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const compiled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist-electron/electron/services/meetingDetection/meetingLinks.js');
const { meetingRefOf, meetingRefsIn, providerOfHost } = require(compiled);

const key = (url) => meetingRefOf(url)?.key ?? null;
const TEAMS_ID = 'NjQ0OTc2YzAtZDY1Mi00YjA3LWI4MzQtZjc4ZTk3ZDQ5ZWRm';

test('Google Meet: the meeting code, whatever the query', () => {
    assert.equal(key('https://meet.google.com/abc-defg-hij'), 'meet:abc-defg-hij');
    assert.equal(key('https://meet.google.com/abc-defg-hij?authuser=1&hs=179'), 'meet:abc-defg-hij');
    assert.equal(key('https://meet.google.com/ABC-DEFG-HIJ'), 'meet:abc-defg-hij', 'codes compare lowercase');
    for (const home of ['https://meet.google.com/', 'https://meet.google.com/landing', 'https://meet.google.com/new']) {
        assert.equal(key(home), null, `${home} is not a meeting`);
    }
});

test('Zoom: the meeting id from every join shape, never the password', () => {
    assert.equal(key('https://us02web.zoom.us/j/81234567890?pwd=abcDEF123.1'), 'zoom:81234567890');
    assert.equal(key('https://zoom.us/j/912345678'), 'zoom:912345678', '9-digit ids');
    assert.equal(key('https://app.zoom.us/wc/81234567890/join?fromPWA=1&pwd=x'), 'zoom:81234567890', 'web client');
    assert.equal(key('https://us06web.zoom.us/wc/join/81234567890'), 'zoom:81234567890', 'older web client');
    assert.equal(key('https://us02web.zoom.us/s/81234567890'), 'zoom:81234567890', 'host start link');
    assert.equal(key('https://acme.zoom.us/my/Evin.John'), 'zoom-my:evin.john', 'personal room');
    assert.equal(key('zoommtg://zoom.us/join?action=join&confno=81234567890&pwd=x'), 'zoom:81234567890', 'app link in a location');
    assert.equal(key('https://acme.zoomgov.com/j/1612345678'), 'zoom:1612345678');
    assert.equal(key('https://zoom.us/profile'), null);
    assert.equal(key('https://zoom.us/j/123'), null, 'too short to be a meeting id');
    assert.ok(!JSON.stringify(meetingRefOf('https://us02web.zoom.us/j/81234567890?pwd=SECRET')).includes('SECRET'));
});

test('Teams: the meeting thread, encoded in a join link or decoded in the web app', () => {
    const join = `https://teams.microsoft.com/l/meetup-join/19%3ameeting_${TEAMS_ID}%40thread.v2/0?context=%7b%22Tid%22%3a%22x%22%7d`;
    const inCall = `https://teams.microsoft.com/v2/?meetingjoin=true#/l/meetup-join/19:meeting_${TEAMS_ID}@thread.v2/0?context=%7b%7d`;
    assert.equal(key(join), `teams:19:meeting_${TEAMS_ID}@thread.v2`);
    assert.equal(key(inCall), key(join), 'the same meeting in both');
    assert.equal(key('https://teams.live.com/meet/9331234567890?p=abcd'), 'teams-id:9331234567890');
    assert.equal(key('https://teams.microsoft.com/meet/2851234567890?p=XyZ'), 'teams-id:2851234567890');
    assert.equal(key('https://teams.microsoft.com/v2/'), null, 'chat is not a meeting');
});

test('Webex: a personal room or a meeting number', () => {
    assert.equal(key('https://acme.webex.com/meet/jdoe'), 'webex:acme.webex.com/jdoe');
    assert.equal(key('https://acme.webex.com/acme/j.php?MTID=m0123456789abcdef0123456789abcdef'), 'webex-mtid:m0123456789abcdef0123456789abcdef');
    assert.equal(key('https://www.webex.com/pricing'), null);
});

test('look-alike hosts and other sites are not meetings', () => {
    for (const url of ['https://evilzoom.us/j/81234567890', 'https://zoom.us.evil.com/j/81234567890', 'https://docs.google.com/document/d/x', 'https://meet.google.com.evil.com/abc-defg-hij', 'javascript:alert(1)', '', 'not a url']) {
        assert.equal(key(url), null, url);
    }
    assert.equal(providerOfHost('US02WEB.ZOOM.US'), 'zoom');
    assert.equal(providerOfHost('teams.cloud.microsoft'), 'teams');
    assert.equal(providerOfHost('meet.google.com.'), 'meet', 'a trailing root dot');
});

test('free text: every distinct meeting in an HTML description or a location', () => {
    const zoomInvite = 'Join Zoom Meeting<br><a href="https://us02web.zoom.us/j/81234567890?pwd=abc&amp;uname=x">https://us02web.zoom.us/j/81234567890?pwd=abc</a><br>Meeting ID: 812 3456 7890';
    assert.deepEqual(meetingRefsIn(zoomInvite).map((r) => r.key), ['zoom:81234567890'], 'the href and the text are one meeting');
    const teamsInvite = `Microsoft Teams meeting\nJoin: <https://teams.microsoft.com/l/meetup-join/19%3ameeting_${TEAMS_ID}%40thread.v2/0?context=x>\nDocs: https://docs.google.com/d/1`;
    assert.deepEqual(meetingRefsIn(teamsInvite).map((r) => r.key), [`teams:19:meeting_${TEAMS_ID}@thread.v2`]);
    assert.deepEqual(meetingRefsIn('Room 4 (https://meet.google.com/abc-defg-hij).').map((r) => r.key), ['meet:abc-defg-hij'], 'trailing punctuation');
    assert.deepEqual(meetingRefsIn('https://meet.google.com/abc-defg-hij then https://zoom.us/j/912345678').map((r) => r.provider), ['meet', 'zoom']);
    assert.deepEqual(meetingRefsIn(undefined), []);
});
