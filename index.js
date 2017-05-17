const Koa = require('koa');
const kbody = require('koa-bodyparser');
const config = require('./config');
const chalk = require('chalk');
const spawn = require('child_process').spawn;
const crypto = require('crypto');

const app = new Koa();

function formatOutput(repo, data) {
  return `${chalk.black.bgGreen(`[${repo.name}]`)} ${chalk.yellow(new Date().toLocaleString())}: ` +
        `${(data.toString().split('\n').length >= 3 ? '\n' : '') + data}`;
}

// Validate that the x-hub-signature is valid
function verifySignature() {
  return async (ctx, next) => {
    const signature = ctx.request.headers['x-hub-signature'];
    const payload = JSON.stringify(ctx.request.body);
    const hmac = crypto.createHmac('sha1', process.env.GITHUB_SECRET_TOKEN).update(payload, 'utf-8').digest('hex');
    if (`sha1=${hmac}` === signature) { await next(); } else { ctx.status = 401; }
  };
}
app.use(kbody());
app.use(verifySignature());
app.use(async (ctx) => {
  if (ctx.request.url === '/deploy_handler' && ctx.request.headers['x-github-event'] === 'release') {
    const repo = config[ctx.request.body.repository.full_name];
    if (repo) {
      let deploy;
      switch (repo.type) {
        case 'node':
          deploy = spawn('sh', ['node_deploy.sh', repo.git_url, repo.name]);
          break;
        case 'web':
          deploy = spawn('sh', ['web_deploy.sh', repo.git_url, repo.name, repo.location]);
          break;
        default:
          break;
      }
      console.log(chalk.bgCyan.black(`===Deploying ${repo.name}===`));
      deploy.stdout.on('data', data => console.log(formatOutput(repo, data)));
      deploy.stderr.on('data', data => console.error(formatOutput(repo, data)));

      const status = await new Promise(resolve =>
                deploy.on('close', (code) => {
                  let color = chalk.bgCyan.black;
                  if (code !== 0) { color = chalk.bgRed.black; }
                  console.log(color(`===${repo.name} deployment closed with code ${code}===`));
                  resolve(code);
                }));
      if (status !== 0) { ctx.status = 500; } else { ctx.status = 200; }
    }
  }
});

app.listen(8000);