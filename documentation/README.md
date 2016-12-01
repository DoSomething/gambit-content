# API


## Chatbot

Endpoint                                       | Functionality                                           
---------------------------------------------- | --------------------------------------------------------
`POST /v1/chatbot` | [CampaignBot chat](endpoints/chatbot.md)


## DonorsChooseBot

Endpoint                                       | Functionality                                           
---------------------------------------------- | --------------------------------------------------------
`POST /v1/donorschoosebot` | [DonorsChooseBot chat](endpoints/donorschoosebot.md)


## Campaigns

Endpoint                                       | Functionality                                           
---------------------------------------------- | --------------------------------------------------------
`GET /v1/campaigns` | [Retrieve all campaigns](endpoints/campaigns.md#retrieve-all-campaigns)
`GET /v1/campaigns/:id` | [Retrieve a campaign](endpoints/campaigns.md#retrieve-a-campaigns)


## Signups

Endpoint                                       | Functionality                                           
---------------------------------------------- | --------------------------------------------------------
`POST /v1/signups` | [Post existing signup](endpoints/signups.md)


## Notifications

Endpoint                                       | Functionality                                           
---------------------------------------------- | --------------------------------------------------------
`POST /v1/notifications/reminder` | [Post relative reminder](endpoints/notifications.md)

## Legacy

> :memo: We're looking to deprecate these, so don't get too attached!

Endpoint                                       | Functionality                                           
---------------------------------------------- | --------------------------------------------------------
`POST /reportback/:campaignName` | [Reportback chat](https://github.com/DoSomething/gambit/wiki/API#reportback)
