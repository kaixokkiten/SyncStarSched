# Scrape Starbucks Shifts and Populate into Google Calendar

## Setup

1. Create [New Google Calendar](https://calendar.google.com/calendar/r/settings/createcalendar), named "Starbucks"
  * For Funsies, change the color to  [`#067655`](https://brandpalettes.com/starbucks-coffee-color-codes/)!  
   ![starbucks calendar color](https://user-images.githubusercontent.com/18796736/170651363-fc9ce286-2525-49bf-81a5-f659ceb48d6b.png).
2. To run this in Google's cloud shell, open the [cloud shell](https://console.cloud.google.com/). 

   ![open the cloud shell](https://user-images.githubusercontent.com/18796736/170654991-dbeeb33e-0f1e-480a-979c-744ae0a68651.png)
3. Switch to the Editor mode. (you can also do this part without the editor mode but I used the VSCode)

   ![switch to the Editor mode](https://user-images.githubusercontent.com/18796736/171985656-373c7768-bd0d-4914-957b-23d402f183d8.png)

4. create a file called ``syncstarsched.sh`` in the home directory with this in it. DO change the ``[your google username]`` part to the username of the google account you are running this on.
```bash
#!/bin/bash
set -euxo pipefail
cd /home/[your google username]/SyncStarSched
npm install
sudo apt-get install -y libxss1 libgtk-3-0 
node .
```
5.  Create your [credentials](https://console.cloud.google.com/apis/credentials). Pick OAuth Client ID, (it might make you create an OAuth Consent Screen).
![its an OAuth thing](https://user-images.githubusercontent.com/18796736/171986064-f8fd7d21-04ab-4a48-a8b8-72712ee6110d.png)
 `credentials.json`

### Missing Files

The following files are removed from source control via the `.gitingore`

```
credentials.json
token.json
secrets.json
```
5. ``cd ..``
6. ``node .``

[NodeJs Calendar Quickstart](https://developers.google.com/calendar/quickstart/nodejs)

```bash
npm init
npm install googleapis --save
npm install superagent --save
npm install puppeteer --save
npm install moment --save
```



**Credentials** can be obtained by downloading form [Github API Console](https://console.developers.google.com/)

**Token** is generated and saved to the local file system by running the app and granting access to the developer credentials for a particular user and scope.

**Secrets** contains the unique information needed to log on to your account and obtain your schedule information and pass along to your calendar.  It should have the following format:

```json
{
    "partnerId": "?",
    "password": "?",
    "securityPrompts": {
        "What was your favorite childhood game?" : "?",
        "What city do you grow up in?" : "?"
    }
}
```

## Run

```bash
node .
```

On first run, node terminal with prompt for OAuth credentials.  Follow the link, authorize the app, copy the auth code, and the token will be saved to `.\token.json`

## Features

1. Login
2. Scrape
3. Parse (moment.js)
4. Google OAuth
5. Retrieve All events and compare
6. Insert New events
7. Delete Removed Events in the future
8. Run on schedule (Azure Functions)
9. Send Email alert when new events added

## Config Settings

* OAuth Google Sign In OR API Key
* Starbucks Sign In & Security Questions
* Calendar ID - One Time Setup  - use SBux Color

## Modules

* [file system (fs)](https://nodejs.org/api/fs.html)
* [node readline](https://nodejs.org/api/readline.html)

## Event Body Format

```js
{  
  'summary': 'Starbucks Shift',
  'location': '49 Church St #2072, Burlington, VT 05401',
  'description': 'Automatically added from https://mysite.starbucks.com/MySchedule/Schedule.aspx.',
  'start': {
    'dateTime': '2018-12-28T12:00:00-05:00',
    'timeZone': 'America/New_York'
  },
  'end': {
    'dateTime': '2018-12-28T17:00:00-05:00',
    'timeZone': 'America/New_York'
  },
  'reminders': {
    'useDefault': false,
    'overrides': [
      {'method': 'popup', 'minutes': 60 * 4}
      {'method': 'popup', 'minutes': 60}
      {'method': 'popup', 'minutes': 15}
    ]
  }
}
```
