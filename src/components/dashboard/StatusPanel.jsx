import React from 'react';

export default function StatusPanel() {
    // This would be dynamic data in a real implementation
    const stats = {
        running: 2,
        completed: 15,
        failed: 1,
        totalContacts: 247
    };

    return (
        <div className="card p-5 h-full hover:shadow-md transition">
            <h2 className="text-xl font-semibold mb-5 flex items-center">
                <span className="material-icons mr-3 text-primary">analytics</span>
                Live Status
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-primary-light rounded-lg p-4 hover:shadow-sm transition">
                    <div className="text-sm font-medium text-primary">Running</div>
                    <div className="flex items-center mt-1">
                        <span className="text-3xl font-bold text-primary">{stats.running}</span>
                        <span className="material-icons ml-2 text-primary">pending</span>
                    </div>
                </div>

                <div className="bg-success-light rounded-lg p-4 hover:shadow-sm transition">
                    <div className="text-sm font-medium text-success">Completed</div>
                    <div className="flex items-center mt-1">
                        <span className="text-3xl font-bold text-success">{stats.completed}</span>
                        <span className="material-icons ml-2 text-success">check_circle</span>
                    </div>
                </div>

                <div className="bg-error-light rounded-lg p-4 hover:shadow-sm transition">
                    <div className="text-sm font-medium text-error">Failed</div>
                    <div className="flex items-center mt-1">
                        <span className="text-3xl font-bold text-error">{stats.failed}</span>
                        <span className="material-icons ml-2 text-error">error</span>
                    </div>
                </div>

                <div className="bg-secondary-light rounded-lg p-4 hover:shadow-sm transition">
                    <div className="text-sm font-medium text-secondary">Total Contacts</div>
                    <div className="flex items-center mt-1">
                        <span className="text-3xl font-bold text-secondary">{stats.totalContacts}</span>
                        <span className="material-icons ml-2 text-secondary">people</span>
                    </div>
                </div>
            </div>

            <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-sm font-medium">Current Progress</h3>
                    <span className="text-xs px-2 py-1 bg-primary-light text-primary rounded-full font-medium">70%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5 mb-2">
                    <div className="bg-primary h-2.5 rounded-full" style={{ width: '70%' }}></div>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                    <span>172/247 leads</span>
                    <span>ETA: 5 min</span>
                </div>
            </div>

            <div className="border-t border-light pt-4">
                <h3 className="text-sm font-medium mb-3">Recent Activity</h3>
                <div className="space-y-3">
                    <div className="flex p-3 rounded-md bg-accent hover:bg-success-light transition">
                        <span className="material-icons text-success mr-3">check_circle</span>
                        <div className="text-sm">
                            <div className="font-medium">Restaurants in Miami</div>
                            <div className="text-xs text-gray-500">125 leads extracted</div>
                        </div>
                    </div>

                    <div className="flex p-3 rounded-md bg-accent hover:bg-primary-light transition">
                        <span className="material-icons text-primary mr-3">pending</span>
                        <div className="text-sm">
                            <div className="font-medium">Coffee shops in Seattle</div>
                            <div className="text-xs text-gray-500">72/120 - in progress</div>
                        </div>
                    </div>

                    <div className="flex p-3 rounded-md bg-accent hover:bg-error-light transition">
                        <span className="material-icons text-error mr-3">error</span>
                        <div className="text-sm">
                            <div className="font-medium">Law firms in Boston</div>
                            <div className="text-xs text-gray-500">API limit reached</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
