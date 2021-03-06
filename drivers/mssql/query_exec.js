const Request = require('tedious').Request;
const QueryBuilder = require('./query_builder.js');

// ****************************************************************************
// QueryBuilder "Query Execution" methods.
// ****************************************************************************
class QueryExec extends QueryBuilder {
    constructor() {
        super();
    }

    _exec(sql, cb) {
        if (Object.prototype.toString.call(this._connection) === Object.prototype.toString.call({})) {
            const request = new Request(sql, (err, count, results) => {
                // Standardize some important properties
                if (!err && results && Array.isArray(results)) {
                    if (results.length === 0) {
                        results = {insert_id: null, affected_rows: 0, changed_rows: 0};

                        // Affected & Changed Rows
                        if (count) {
                            results.affected_rows = count;
                            // Only set changed rows on an update
                            if (/^update\s/i.test(sql)) results.changed_rows = count;
                        }
                    } else {
                        const data = results.map(row => row.map(col => ({[col.metadata.colName]: col.value})).reduce((l,r) => Object.assign(l,r)))
                        if (/^insert\s/i.test(sql)) {
                            results = {insert_id: data, affected_rows: (count ? count : 0), changed_rows: 0};
                        } else {
                            results = data;
                        }
                    }
                }

                cb(err, results);
            });

            if (!this._connection) {
                this._connection.connect(err => {
                    if (err) return cb(err, null);
                    this._connection.execSql(request);
                });
            } else {
                //console.log("connection object2: ", this._connection);
                this._connection.execSql(request);
            }
        } else {
            throw new Error("No connection object supplied to the Query Exec Library!");
        }
    }

    query(sql, cb) {
        this._exec(sql, cb);
    }

    count(table, cb) {
        if (typeof table === 'function' && typeof cb !== 'function') {
            table = null;
            cb = table;
        }

        const sql = this._count(table);
        this.reset_query(sql);
        this._exec(sql, (err, row) => {
            if (!err) {
                //console.dir(row[0].numrows);
                cb(err, row[0].numrows);
            }
            else {
                cb(err, row);
            }
        });
    }

    get(table,cb,conn) {
        // The table parameter is optional, it could be the cb...
        if (typeof table === 'function' && typeof cb !== 'function') {
            cb = table;
        }
        else if (typeof table === 'undefined' && typeof cb !== 'function') {
            throw new Error("No cb function has been provided in your 'get' call!");
        }

        const sql = this._get(table);
        this.reset_query(sql);
        this._exec(sql,cb);
    }

    get_where(table,where,cb) {
        if (typeof table !== 'string' && !Array.isArray(table)) {
            throw new Error("First parameter of get_where() must be a string or an array of strings.");
        }
        if (Object.prototype.toString.call(where) !== Object.prototype.toString.call({})) {
            throw new Error("Second parameter of get_where() must be an object with key:value pairs.");
        }
        const sql = this._get_where(table,where);
        this.reset_query(sql);
        this._exec(sql,cb);
    }

    insert(table, set, cb, ignore, suffix) {
        const sql = this._insert(table, set, ignore, suffix);
        this.reset_query(sql);
        this._exec(sql,cb);
    }

    insert_ignore(table, set, on_dupe, cb) {
        throw new Error("insert_ignore(): This feature is currently unsupported in the MSSQL driver.");
        // if (typeof on_dupe === 'function') {
        //     cb = on_dupe;
        //     on_dupe = null;
        // }
        // const sql = this._insert_ignore(table,set,on_dupe);
        // this.reset_query(sql);
        // this._exec(sql,cb);
    }

    insert_batch(table, set, ignore, on_dupe, cb) {
        if (typeof ignore === 'function') {
            cb = ignore;
            ignore = null;
         }
         else if (typeof on_dupe === 'function') {
          cb = on_dupe;
          on_dupe = null;
        }

        if (ignore) throw new Error("QE insert_batch(): INSERT IGNORE is currently unsupported on the MSSQL driver.");
        if (suffix) throw new Error("QE insert_batch(): 'on_dupe' string (4th parameter) is currently unsupported on the MSSQL driver.");

        const sql = this._insert_batch(table, set);
        this.reset_query(sql);
        this._exec(sql, cb);
    }

    update(table,set,where,cb) {
        // The where parameter is optional, it could be the cb...
        if (typeof where === 'function' && typeof cb !== 'function') {
            cb = where;
            where = null;
        }
        else if (typeof where === 'undefined' && typeof cb !== 'function') {
            throw new Error("No cb function has been provided in your update call!");
        }
        else if (typeof where === 'undefined' || where === false || (where !== null && typeof where === 'object' && where.length == 0)) {
            where = null;
        }

        const sql = this._update(table,set,where);
        this.reset_query(sql);
        this._exec(sql,cb);
    }

    // TODO: Write this complicated-ass function
    update_batch(table,set,index,where,cb) {
        // The where parameter is optional, it could be the cb...
        if (typeof where === 'function' && typeof cb !== 'function') {
            cb = where;
            where = null;
        }
        else if (typeof where === 'undefined' && typeof cb !== 'function') {
            throw new Error("No cb function has been provided in your update_batch call!");
        }
        else if (typeof where === 'undefined' || where === false || (where !== null && typeof where === 'object' && where.length == 0)) {
            where = null;
        }

        const sqls = this._update_batch(table,set,index,where);
        const results = null;
        const errors = [];

        // Execute each batch of (at least) 100
        (function next_batch() {
            const sql = sqls.shift();
            this.reset_query(sql);

            this._exec(sql, (err, res) => {
                if (!err) {
                    if (null === results) {
                        results = res;
                    } else {
                        results.affected_rows += res.affected_rows;
                        results.changed_rows += res.changed_rows;
                    }
                } else {
                    errors.push(err);
                }

                if (sqls.length > 0) {
                    setTimeout(next_batch,0);
                } else {
                    return cb(errors, results);
                }
            });
        })();
    }

    delete(table, where, cb) {
        if (typeof where === 'function' && typeof cb !== 'function') {
            cb = where;
            where = undefined;
        }

        if (typeof table === 'function' && typeof cb !== 'function') {
            cb = table;
            table = undefined;
            where = undefined;
        }

        if (typeof cb !== 'function') {
            throw new Error("delete(): No callback function has been provided!");
        }

        const sql = this._delete(table, where);

        this.reset_query(sql);
        this._exec(sql,cb);
    }

    empty_table(table, cb) {
        const sql = this._empty_table(table,cb);
        this.reset_query(sql);
        this._exec(sql,cb);
    }

    truncate(table, cb) {
        const sql = this._truncate(table,cb);
        this.reset_query(sql);
        this._exec(sql,cb);
    }
}

module.exports = QueryExec;
