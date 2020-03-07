var request = require('supertest')('https://senseapps.ptarmiganlabs.net:8001');
var expect = require('chai').expect;


describe('Butler app duplicator for Qlik Sense', function () {
    this.timeout(10000);

    it('Get app templates', function (done) {
        request
            .get('/getTemplateList')
            .expect(200)
            .expect('Content-Type', 'application/json')
            .expect('Server', 'Qlik Sense app duplicator')
            .then(function (res) {
                // console.log(res);
                done();
            })
            .catch(function (err) {
                // console.log('err ' + err);
                if (err) return done(err);
                done();
            })
    })

    it('Duplicate app (keep load script)', function (done) {
        request
            .get('/duplicateKeepScript')
            .query('templateAppId=0311cafa-8d35-4aa3-a85a-ab356627b93e')
            .query('&appName=atest1')
            .query('ownerUserId=goran')
            .expect(200)
            .expect('Content-Type', 'application/json')
            .expect('Server', 'Qlik Sense app duplicator')
            .then(function (res) {
                expect(res.body.result.substr(0, 20)).to.equal('Done duplicating app');
                done();
            })
            .catch(function (err) {
                if (err) return done(err);
                done();
            })
    })

    it('Duplicate app (replace load script)', function (done) {
        request
            .get('/duplicateNewScript')
            .query('templateAppId=0311cafa-8d35-4aa3-a85a-ab356627b93e')
            .query('&appName=atest2')
            .query('ownerUserId=goran')
            .expect(200)
            .expect('Content-Type', 'application/json')
            .expect('Server', 'Qlik Sense app duplicator')
            .then(function (res) {
                expect(res.body.result.substr(0, 20)).to.equal('Done duplicating app');
                done();
            })
            .catch(function (err) {
                if (err) return done(err);
                done();
            })
    })

});