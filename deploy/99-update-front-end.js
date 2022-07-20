// writing a script in the backend that connects to our frontend
// such that everytime we deploy a contract, no matter what chain,
// we update the constants.json file

module.exports = async function () {
    if (process.env.UPDATE_FRONT_END) {
        console.log("Updating front end...")
    }
}
