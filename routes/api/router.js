const router = require('express').Router()
const bodyParser = require('body-parser')

const cors = require("../../my_modules/cors")
const accountAPI = require('../../my_modules/accountapi')

// /api

router.use('/upgrade/coinbase-webhook', require('./upgrade/coinbase-webhook'))

router.use('/stripe', cors, require('./upgrade/stripe'))

//Account check
router.use(async (req, res, next) => {
    if(req.session.uid) {
        let account = await accountAPI.fetchAccount(req.session.uid)

        //Reject APi calls from locked accounts
        if(account && "locked" in account) return res.status(403).send({success: false, "reason": `Your account has been locked.`})
    }

    next()
})

// parse application/json
router.use(bodyParser.urlencoded({ extended: true }));
router.use(bodyParser.json({limit: '5mb'}))

//Every API route below needs cors 
router.options('*', cors)
router.use('/thread', require('./thread/router'))
router.use('/reply', require('./reply/router'))
router.use('/account', require('./account/router'))
router.use('/message', require('./message/router'))
router.use('/notifications', cors, require('./notifications'))
router.use('/dashboard', require('./dashboard/router'))
router.use('/upgrade/createCoinbaseCharge', require('./upgrade/createCoinbaseCharge'))

module.exports = router;