#!/usr/bin/env node
const path = require('path')
const url = require('url')
const fs = require('fs')

//parse arguments
//git/branch/port
const opt = require('optimist')
const argv =
opt
.usage('Simple continuous integration tool.\n\nUsage: ci [options] [target directory]')
.string('g').demand('g').alias('g','git').describe('g','Git server URL')
.string('u').demand('u').alias('u','username').describe('u','Git user name')
.string('p').demand('p').alias('p','password').describe('p','Git password')
.default('P',8081).alias('P','port').describe('P','Listening port')
.boolean('h').alias('h','help').describe('h','Show this help and exit')
.string('b').alias('b','branch').default('b','master').describe('b','Branch to watch')
.argv

if (argv.h) {
	console.log(opt.help())
	process.exit(0)
}

const opts = {
	port:	argv.port,
	dir:	path.resolve(String(argv._[0] || './')),
	git:	url.parse(argv.g),
	username:	argv.username,
	password:	argv.password,
	branch:	argv.branch
}

//create target directory if not exist
const mkdirp = require('mkdirp')
mkdirp(opts.dir, err=>{if(err)console.log(err)})

const Koa = require('koa')
const Router = require('koa-router')
const app = new Koa()
const router = new Router()

const json = require('koa-json')
const onerror = require('koa-onerror')
const bodyparser = require('koa-bodyparser')
const logger = require('koa-logger')

const git = require('isomorphic-git')
git.plugins.set('fs',fs)

onerror(app)
app
.use(logger())
.use(bodyparser())
.use(json())
.use(router.routes())
.use(router.allowedMethods())

app.on('error', (err, ctx)=>{
	console.error('server error', err)
})

const ip = require('ip')
const ip_addr = ip.address()
const ip_port = `${ip_addr}:${opts.port}`
app.listen(opts.port, () => {
	const msg = 
`
Servermore-ci is up and running.

Switched to branch "${opts.branch}"

Git server: ${opts.git.href}

Local repo: ${opts.dir}

Hooks:
	http://${ip_port}/hook/gogs/push
	http://${ip_port}/hook/sm
`
	console.log(msg)
})

//https://gogs.io/docs/features/webhook
function parse_gogs_msg(msg){
	const res = {}
	res.name = msg.repository.full_name
	res.ref = msg.ref
	res.branch = msg.ref.split('/').pop()
	//res.singleBranch = true
	if (msg.commits) {
		res.commits = {
			added:[],
			removed:[],
			modified:[]
		}
		for(const c of msg.commits){
			res.commits.added.push(...c.added)
			res.commits.removed.push(...c.removed)
			res.commits.modified.push(...c.modified)
		}
	}
	res.username = opts.username
	res.password = opts.password
	res.dir = path.resolve(opts.dir, res.name)
	return res
}

router.post('/hook/gogs/push', async (ctx,next)=>{
	try{
		const p = parse_gogs_msg(ctx.request.body)
		if (p.branch === opts.branch) {
			console.log(' [HOOK]\n',p)

			//found repo. pull
			if (fs.existsSync(p.dir)) {
				await git.pull(p)
				console.log(p.name,'updated.')
			} else {
				console.log(p.name,'doesn\'t exist. Ignore.')
			}
		}
		ctx.body = ''
	}catch(e){
		console.log(e)
		ctx.status = 400
		ctx.body = ''
	}
})

function parse_git_cmd(cmd){
	const obj = {
		protocol:'http',
		hostname:opts.git.hostname,
		pathname:cmd.path+'.git',
		port:opts.git.port
	}
	const repo_url = url.format(obj)
	const res = {
		dir:path.join(opts.dir,cmd.path),
		url:repo_url,
		//singleBranch:true,
		depth:1,
		username:opts.username,
		password:opts.password,
		cmd:cmd.cmd
	}

	return res
}

const checkout_dict = {}

async function git_checkout(res){
	if (!checkout_dict[res.dir]) {
		await git.checkout(res)
		checkout_dict[res.dir] = true
	}
}

async function git_clone(res){
	await git.clone(res)
	checkout_dict[res.dir] = true
}

router.post('/hook/sm', async (ctx,next)=>{
	const res = parse_git_cmd(ctx.request.body)
	res.ref = opts.branch

	if (fs.existsSync(res.dir)) {
		await git_checkout(res)
	} else {
		//otherwise clone
		await git_clone(res)
	}
	ctx.body = ''
})
