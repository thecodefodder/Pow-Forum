const router = require('express').Router()
var escape = require('escape-html')
const crypto = require('crypto')
const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

const other = require('../../../../my_modules/other')
const mailgun = require('../../../../my_modules/mailgun')
const tfa = require('../../../../my_modules/2fa')
const accountAPI = require('../../../../my_modules/accountapi')

const ForumSettings = mongoose.model("ForumSettings")
const Logs = mongoose.model("Logs")
const Accounts = mongoose.model("Accounts")
const PendingEmailVerifications = mongoose.model("PendingEmailVerifications")
const TFAs = mongoose.model("TFAs")

// /v1/account/manager

//update account security tab
router.post('/', async (req, res) => {
	let response = {success: false}
	
	try{
		//Only allow logged in users
		if(!req.session.uid)
			throw {safe: "Not logged in"};

		var accData = await accountAPI.fetchAccount(req.session.uid)
		
		//Must enter password to change any security info
		var curPassword = req.body.currentpassword
		if(!req.body.currentpassword) throw {safe: "Missing current password"};
		if(!await accountAPI.CheckPassword(req.session.uid, curPassword)) throw "Incorrect current password"
		
		//Contains all data to update in database
		let keyvalues = {}

		//Sets new password
		if(req.body.newpassword){
			var newPassword = req.body.newpassword

			let validatedPassword = accountAPI.ValidatePassword(newPassword)
			if(validatedPassword !== true) throw validatedPassword
			
			newPassword = await bcrypt.hash(newPassword, 10)
			
			//No need to sanitize password. It can be what ever they want!
			//No need to escape since their password wouldn't be displayed as html anywhere
			keyvalues.password = newPassword
		}
		
		//Sets new email
		if(req.body.hasOwnProperty('email') && req.body.email !== accData.email){
			//Rate limit email changes to once/day to prevent mailgun over charges
			await Logs.findOne({uid: req.session.uid, action: "update_email", date: {$gte: new Date() - 1000*60*60*24}})
			.then(doc => {
				if(doc) throw {safe:"You must wait 24 hours since your last email change request."}
			})

			if(!other.ValidateEmail(req.body.email)) throw {safe:"Invalid email"};
			if(!mailgun.isEmailCompatible(req.body.email)) throw { safe: "Incompatible email provider. Use another email address such as GMail" }

			keyvalues.email = escape(req.body.email)
		}

		if(!(Object.keys(keyvalues).length > 0)) throw {safe: "No changes requested..."};

		//Updates account
		await Accounts.updateOne({_id: req.session.uid}, keyvalues)

		// Create email verification session
		if(keyvalues.email){
			//Creates verification token
			var hash = crypto.randomBytes(64).toString('hex');

			//Send verification email
			var emailBody = 'Hello,\n\n' +
			`${accData.username}(ID:${req.session.uid}) at ${process.env.FORUM_URL} wants to use your email as the account holder. To verify this email address, please visit the link below. In doing so, you remove restriction from services such as posting to the forum and enable higher account security.\n\n` +
			`${process.env.FORUM_URL}/verify?token=${hash}\n\n` + 
			`This message was generated by ${process.env.FORUM_URL}.`
			
			await mailgun.SendBasicEmail(keyvalues.email, `${(await ForumSettings.findOne({type: "title"})).value} Email Verification`, emailBody)
			.then(async err=>{
				if(err) throw err

				//The email has sent, so store token in database to be verified against
				await PendingEmailVerifications.findOneAndUpdate({_id: req.session.uid}, {
					_id: req.session.uid,
					token: hash,
					lastsent: new Date()
				}, {upsert: true})
			})
			.catch(err=>{
				console.warn("Issue when sending the email verification at register: ", err)
			})

			//Log the email change request so we can rate limit to 1 email change request/day. This is rate limited so I don't get over charged by mailgun api
			await new Logs({
				uid: req.session.uid,
				action: "update_email",
				description: keyvalues.email, //Changed to this email
				date: new Date() //Current date
			}).save()
		}
		
		response.success = true
	}
	catch(e){
		response.reason = "Server error"
		if(e.safe && e.safe.length > 0) response.reason = e.safe;
		else if (typeof e === "string") response.reason = e
		else console.warn(e)
	}
	
	res.json(response)
});

//Enable 2FA
router.post('/enable2fa', async (req, res) => {
	let response = {success: false}
	
	try{
		//Only allow logged in users
		if(!req.session.uid) throw "Not logged in";

		response.qrcode = await tfa.enable(req.session.uid)
		response.success = true
	}
	catch(e){
		response.reason = "Server error"
		if(typeof e === "string") response.reason = e;
		else console.warn(e)
	}
	
	res.json(response)
})

//Verify 2FA
//Enables account 2FA if they send the correct 2FA auth code
router.post('/verify2fa', async (req, res) => {
	let response = {success: false}
	
	try{
		//Only allow logged in users
		if(!req.session.uid) throw "Not logged in";

		//A token must be sent & sanitized
		if(!req.body.token) throw "Missing token";

		var verified = await tfa.verify(req.session.uid, req.body.token)
		if(verified)  await TFAs.updateOne({_id: req.session.uid}, {verified: 1})
		else throw "Incorrect code"
		
		response.success = true
	}
	catch(e){
		response.reason = "Server error"
		if(typeof e === "string") response.reason = e;
		else console.warn(e)
	}
	
	res.json(response)
})

//Disable 2fa
router.post('/disable2fa', async (req, res) => {
	let response = {success: false}
	
	try{
		//Only allow logged in users
		if(!req.session.uid) throw "Not logged in";

		//A token must be sent & sanitized
		if(!req.body.token) throw "Missing token";

		var verified = await tfa.verify(req.session.uid, req.body.token)
		if(!verified) throw "Incorrect code"

		await TFAs.deleteOne({_id: req.session.uid})

		response.success = true
	}
	catch(e){
		response.reason = "Server error"
		if(typeof e === "string") response.reason = e;
		else console.warn(e)
	}
	
	res.json(response)
})

module.exports = router;