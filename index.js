const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const puppeteer = require('puppeteer');
const config = require('./config.json');
const secrets = require('./secrets.json');
const moment = require('moment-timezone');

const colors = {
    Bright: "\x1b[1m"  + "%s" + "\x1b[0m",
    Dim:    "\x1b[2m"  + "%s" + "\x1b[0m",
    Black:  "\x1b[30m" + "%s" + "\x1b[0m",
    White:  "\x1b[37m" + "%s" + "\x1b[0m",
    Red:    "\x1b[31m" + "%s" + "\x1b[0m",
    Green:  "\x1b[32m" + "%s" + "\x1b[0m",
    Yellow: "\x1b[33m" + "%s" + "\x1b[0m",
    Blue:   "\x1b[34m" + "%s" + "\x1b[0m",
};

const defaultEvent = JSON.parse(fs.readFileSync("./event.json"));

// launch program with async iife
(async () => {

    const calendarApi = await getCalendarApi()
    
    const upcomingEvents = await getCalendarEvents(calendarApi)
    
    const schedule = await scrapeStarbucks()

    await syncSchedule(calendarApi, schedule, upcomingEvents)

})()

async function scrapeStarbucks() {
    // open browse and navigate to page
    const browser = await puppeteer.launch({headless: true, devtools: false}); // update config in prod
    const page = await browser.newPage();
    await page.goto(config.urls.starbucks);

    // get initial page status
    await page.waitForSelector("input.textbox")
    pageStatus = await getPageStatus(page);

    // request interception is a funsier way to do this
    let waitForData;
    {
      let _resolve = [];
      let _data = [];
      page.on('requestfinished', request => {
        if (!request.url().match("/retail/data/wfmess/api/.*/mySchedules/")) return;
        request.response().buffer().then(resp => {
          console.log("downloaded");
          if (_resolve.length) _resolve.shift()(resp);
          else _data.push(resp);
        });
      });
      waitForData = () => new Promise(resolve => {
          console.log("requested");
        if (_data.length) resolve(_data.shift());
        else _resolve.push(resolve);
      });
    }


    // keep smashing buttons until we're on schedule page
    while (!pageStatus.schedulePage) {
     
        if (pageStatus.partnerPage) {
            await page.focus("input.textbox.txtUserid")
            await page.keyboard.type(secrets.partnerId)

        } else if (pageStatus.passwordPage) {
            await page.focus("input.textbox.tbxPassword")
            await page.keyboard.type(secrets.password)

        } else if (pageStatus.securityPage) {
            const securityAnswer = secrets.securityPrompts[pageStatus.securityQuestion];
            await page.focus("input.textbox.tbxKBA")
            await page.keyboard.type(securityAnswer)
        }

        // submit form
        page.click("input[type='submit']:not(.aspNetDisabled)")

        // wait for navigation and dom and check page
        await page.waitForNavigation({waitUntil: 'networkidle2'});
        await page.waitForSelector("input.textbox,.x-component")
        pageStatus = await getPageStatus(page);
    }


    // go hunting for info we want
    const shifts = [];
    while (true) {
      const data = JSON.parse(await waitForData());
      if (data.hasUnpostedShifts || data.netScheduledHours === 0) break;
      for (const day of data.days) {
        for (const pss of day.payScheduledShifts) {
          shifts.push({
            job_type: pss.job.name,
            details: pss.scheduleDetails.map(d => d.detailType + ": " + d.start.split("T").pop() + " - " + d.end.split("T").pop()).join("\n"),
            start: pss.start,
            end: pss.end
          });
        }
      }

      // push next button
      const frame = await (await page.waitForSelector(".x-component")).contentFrame();
      await frame.waitForSelector("#button-1029-btnIconEl");
      await frame.click("#button-1029-btnIconEl");
    }

    // log events for "fun"
    console.log(colors.Green, "Downloaded shift(s):");
    shifts.forEach(({job_type, details, start, end}) => console.log(job_type, start, end, JSON.stringify(details)));
    console.log("\r\n");

    // Closing Time
    await browser.close();

    return shifts
}
async function getPageStatus(myPage) {
    // determine what page we're on
    return await myPage.evaluate(() => {
            
        const partner = document.querySelectorAll(".txtUserid")
        const passBox = document.querySelectorAll("input.tbxPassword")
        const secQuestion = document.querySelector(".bodytext.lblKBQ.lblKBQ1")
        const schedule = document.querySelectorAll(".x-component")

        var status = {
            partnerPage: partner.length > 0,
            schedulePage: schedule.length > 0,
            passwordPage: passBox.length > 0,
            securityPage: !!secQuestion,
            securityQuestion: secQuestion ? secQuestion.innerText : ""
        }

        return status;

    })
}


async function getCalendarApi() {
    const oAuth2Client = await getOAuthClient()
    
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    return calendar
}
async function getOAuthClient() {
    // get developer API from credentials.json file
    const credResponse = await readJsonAsync(config.paths.creds)
    if (credResponse.err) console.error(`Error loading file ${credPath}`);
    
    // destructure credentials
    const credentials = credResponse.data
    const { client_secret, client_id, redirect_uris } = credentials.installed;

    // setup oAuth Client
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // get user permission from token.json file
    const tokenResponse = await readJsonAsync(config.paths.token)

    // if we don't have a token file, create one
    const token = tokenResponse.err ? await getAccessToken(oAuth2Client) : tokenResponse.data;

    // authorize client for use    
    oAuth2Client.setCredentials(token);

    return oAuth2Client
}
async function getAccessToken(oAuth2Client) {

    // prompt for online authorization
    const authUrl = oAuth2Client.generateAuthUrl({access_type: 'offline', scope: config.scope});
    console.log('Authorize this app by visiting this url:', authUrl);

    // get response from user
    const authCode = await readlineAskAsync('Enter the code from that page here: ')

    // get token from auth client
    const tokenResponse = await oAuth2Client.getToken(authCode)
    if (tokenResponse.res.statusText != "OK") console.error("Could not retrieve token")

    // Store the token to disk for later program executions
    await writeJsonAsync(config.paths.token, tokenResponse.tokens)

    return tokenResponse.tokens;
}


async function getCalendarEvents(calendar) {

    const calendarId = secrets.cal.id || await getCalendarId(calendar, secrets.cal.name)

    // check current events
    const eventsRes = await calendar.events.list({
        calendarId: calendarId,
        timeMin: (new Date()).toISOString(),
        maxResults: 99,
        singleEvents: true,
        orderBy: 'startTime',
    })
    
    const upcomingEvents = eventsRes.data.items;

    // log events 
    console.log(colors.Yellow, `Retrieved ${upcomingEvents.length} upcoming calendar appointment(s):`)
    upcomingEvents.forEach(evt => {
        console.log(`Event: ${moment(evt.start.dateTime).tz(evt.start.timeZone).format()} to ${moment(evt.end.dateTime).tz(evt.end.timeZone).format()}`.replace(/\ 0/g, '  '));
    });
    console.log("\r\n")

    return upcomingEvents;
}
async function getCalendarId(calendar, calendarName) {
     // call all active calendars to look for this one
     const calRes = await calendar.calendarList.list({})
     const calendars = calRes.data.items;
     const myCal = calendars.filter(cal => cal.summary == calendarName)[0];
     const calendarId = myCal.id; // "60m640rj25mngq7m57j0hbg518@group.calendar.google.com"
 
     return calendarId;

}


async function syncSchedule(calendar, schedule, upcomingEvents) {

    const calendarId = secrets.cal.id || await getCalendarId(calendar, secrets.cal.name)

    // find new shifts
    for (let i=0; i < schedule.length; i++) {
        let shift = schedule[i];

        var matchedEvent = upcomingEvents.some(evt => {
            return +moment(evt.start.dateTime) == +moment.tz(shift.start, config.timeZone) &&
                   +moment(evt.end.dateTime) == +moment.tz(shift.end, config.timeZone);
        })

        shift.isNew = !matchedEvent
        shift.inFuture = +moment.tz(shift.end, config.timeZone) > +moment()
        shift.shouldInsert = shift.isNew && shift.inFuture
    }
    
    // insert new shifts
    var insertShifts = schedule.filter(s=> s.shouldInsert)
    console.log(colors.Green, `Inserting ${insertShifts.length} new shift(s):`)

    for (let i=0; i < insertShifts.length; i++) {
        let shift = insertShifts[i];

        let insertShift = Object.assign({}, defaultEvent)
        insertShift.start.dateTime = moment.tz(shift.start, config.timeZone).format()
        insertShift.start.timeZone = config.timeZone
        insertShift.end.dateTime = moment.tz(shift.end, config.timeZone).format()
        insertShift.end.timeZone = config.timeZone
        insertShift.summary = insertShift.summary.split("[job_type]").join(shift.job_type);
        insertShift.description = insertShift.description.split("[details]").join(shift.details);
        console.log(insertShift);

        let insertRes = await calendar.events.insert({
            calendarId: calendarId,
            requestBody: insertShift,
        })

        console.log(`Inserted: ${shift.start} to ${shift.end}`.replace(/\ 0/g, '  '));
        // todo - send update if requested
    }
    console.log("\r\n")


    // find deleted events
    for (let i = 0; i < upcomingEvents.length; i++) {
        let evt = upcomingEvents[i];
        
        var matchedShift = schedule.some(shift => {
            return +moment(evt.start.dateTime) == +moment.tz(shift.start, config.timeZone) &&
                   +moment(evt.end.dateTime) == +moment.tz(shift.end, config.timeZone);
        })

        evt.shouldDelete = !matchedShift
    }


    // delete events
    var deleteShifts = upcomingEvents.filter(e=> e.shouldDelete)
    console.log(colors.Red, `Deleting ${deleteShifts.length} removed event(s):`)
    for (let i = 0; i < deleteShifts.length; i++) {
        let evt = deleteShifts[i];
        
        await calendar.events.delete({
            calendarId: calendarId,
            eventId: evt.id,
        })

        console.log(`Deleted: ${moment.tz(evt.start.dateTime, evt.start.timeZone).format()} to ${moment.tz(evt.end.dateTime, evt.end.timeZone).format()}`.replace(/\ 0/g, '  '));
    }

}


function readJsonAsync(filePath) {
    return new Promise(
        (resolve) => {
            fs.readFile(filePath, (err, content) => {
                if (err) {
                    resolve({ err })
                } else {
                   resolve({data: JSON.parse(content)}) 
                }
            })
       }
     );
}
function writeJsonAsync(filePath, obj) {
    return new Promise(
        (resolve) => {
            fs.writeFile(filePath, JSON.stringify(obj), (err) => {
                if (err) resolve({ ok: false, err });
                resolve({ok: true, data: {msg: `Object stored to ${filePath}`}})
            })
       }
     );
}
function readlineAskAsync(question) {
    return new Promise(
        (resolve) => {
            // create readline
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });
        
            // await code from user
            rl.question(question, (answer) => {
                rl.close(); // close as soon as we get a response
                resolve(answer)
            });
       }
     );
}
