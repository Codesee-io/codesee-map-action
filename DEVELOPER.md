## How to build

Since actions require the complete node environment to be able to run, we use `@vercel/ncc` to bundle all the dependencies for the action.

The files in dist ARE the action, and you can rebuild them with the command `yarn build`.

Sometimes `ncc` requires to be installed globally, so if you get an error about ncc not being found run `yarn global add @vercel/ncc`
