#!/usr/bin/env node
const path = require('path')
const url = require('url')
const fs = require('fs')
const argv = require('optimist').argv
const opts = {
	port:argv.p || argv.port || 8081,
	dir:path.resolve((argv.d || argv.dir || './').toString()),
	gitHost:url.parse(argv.g || argv.git || 'http://localhost')
}

//如果dir不存在，就创建
const mkdirp = require('mkdirp')
mkdirp(opts.dir, err=>console.log(err))

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

app.listen(opts.port, () => {
	console.log(`servermore listening on port ${opts.port}`)
})

router.post('/push', async (ctx,next)=>{
	try{
		const req = ctx.request.body
		if(req.commits.length>0) {
			const repo = req.repository

			//找repo，找到就pull，找不到就拉倒
			const url_info = url.parse(repo.clone_url)
			const dir_info = path.parse(url_info.path)
			const dir_name = path.join(opts.dir, dir_info.dir, dir_info.name)

			if(fs.existsSync(dir_name)) {
				const params = {
					dir:dir_name,
					singleBranch:true,
					username:'test-ci',
					password:'test-ci'
				}
				await git.pull(params)
				console.log(dir_name,'is updated.')
			} else {
				console.log(dir_name,'is not cloned. Ignore.')
			}
			ctx.body = ''
		}
	}catch(e){
		console.log(e)
		ctx.status = 400
		ctx.body = ''
	}
})

router.post('/clone', async (ctx,next)=>{
	const req = ctx.request.body

	if (req.path) {
		const url_info = url.parse(req.path)
		const dir = url_info.path.split('/').slice(0,3).join('/')
		const dir_name = path.join(opts.dir, dir)
		if (!fs.existsSync(dir_name)) {
			const url_obj = {
				protocol:url_info.protocol,
				hostname:opts.gitHost.hostname,
				pathname:dir+'.git',
				port:opts.gitHost.port
			}
			const repo_url = url.format(url_obj)
			const params = {
				dir:dir_name,
				url:repo_url,
				singleBranch:true,
				depth:1,
				username:'test-ci',
				password:'test-ci'
			}
			console.log(params)
			await git.clone(params)

			console.log(repo_url,'cloned.')
		}
	}

	//找repo，找不到就clone
	ctx.body = ''
})
